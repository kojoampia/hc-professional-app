#!/usr/bin/env bash
#
# Build a release AAB locally, by the same rules release-android.yml uses.
#
# This exists so the release path can be exercised without cutting a tag. The workflow is the only
# thing that publishes, and that stays true — this script signs only if the environment already
# carries a keystore, and prints in bold when it does not, because an unsigned bundle looks exactly
# like a signed one until Play rejects it.
#
# What it does NOT do is lint or test. ci.yml and release-android.yml both gate on those and a tag is
# not exempt; duplicating them here would only make the slow path slower without making the fast one
# safer.
#
# Usage:
#   scripts/build-aab.sh                 # web build + cap sync + bundleRelease
#   scripts/build-aab.sh --skip-web      # gradle only, reusing whatever is already in android/
#   ANDROID_VERSION_CODE=42 scripts/build-aab.sh
#
# Signing, when you want it (all four, or none):
#   ANDROID_KEYSTORE_PATH=/path/upload.jks ANDROID_KEYSTORE_PASSWORD=… \
#   ANDROID_KEY_ALIAS=… ANDROID_KEY_PASSWORD=… scripts/build-aab.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

skip_web=false
for arg in "$@"; do
  case "$arg" in
    --skip-web) skip_web=true ;;
    -h | --help)
      awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown argument $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------------------------
# The JDK. Gradle itself must run on 21, and that is separate from the toolchain pin.
#
# android/build.gradle pins a Java 21 toolchain for every module, which governs what compiles the
# code. This is about the JVM Gradle's own Groovy runs on: on 25 it dies with `Unsupported class
# file major version 69`, which reads as a corrupt build rather than a JDK mismatch and has cost an
# afternoon before. The workstation's ambient JAVA_HOME is a compiler-less 25 JRE, so neither
# inheriting it nor ignoring it is safe — this picks a real 21 and says so.
#
# Running Gradle on 21 also satisfies the toolchain from the same JVM, so one correct JDK is enough
# and Gradle never has to go looking for a second one.
# ---------------------------------------------------------------------------------------------
java_spec_version() {
  "$1/bin/java" -XshowSettings:properties -version 2>&1 |
    sed -n 's/.*java\.specification\.version = \(.*\)/\1/p' | tr -d '[:space:]'
}

resolve_java_home() {
  local candidates=()
  [ -n "${ANDROID_GRADLE_JAVA_HOME:-}" ] && candidates+=("$ANDROID_GRADLE_JAVA_HOME")
  [ -n "${JAVA_HOME:-}" ] && candidates+=("$JAVA_HOME")
  if [ -x /usr/libexec/java_home ]; then
    candidates+=("$(/usr/libexec/java_home -v 21 2>/dev/null || true)") # macOS
  fi
  candidates+=(
    /usr/lib/jvm/java-21-openjdk-amd64
    /usr/lib/jvm/java-1.21.0-openjdk-amd64
    /usr/lib/jvm/openjdk-21
    /usr/lib/jvm/temurin-21-jdk-amd64
  )

  local c
  for c in "${candidates[@]}"; do
    # javac, not java: a JRE passes an existence check and then fails inside the compile task with
    # a message naming a *capability*, which sends you to AGP config rather than to the JDK.
    [ -n "$c" ] && [ -x "$c/bin/javac" ] || continue
    [ "$(java_spec_version "$c")" = "21" ] || continue
    printf '%s' "$c"
    return 0
  done
  return 1
}

if ! JAVA_HOME="$(resolve_java_home)"; then
  cat >&2 <<'EOF'
error: no JDK 21 with a compiler found.

Gradle cannot run on 25 here (`Unsupported class file major version 69`) and the modules compile at
21, per android/build.gradle. Install a JDK 21, or point ANDROID_GRADLE_JAVA_HOME at one:

  ANDROID_GRADLE_JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 scripts/build-aab.sh

Anything matching /usr/lib/jvm/java-*-openjdk-amd64 at 25 is JRE-only and will not do.
EOF
  exit 1
fi
export JAVA_HOME
echo "JDK      $JAVA_HOME (21)"

# ---------------------------------------------------------------------------------------------
# Version. The scheme lives in docs/release.md § Version scheme; this implements the local half.
# ---------------------------------------------------------------------------------------------
ANDROID_VERSION_NAME="$(node -p "require('./package.json').version")"

# 1 by default, matching app/build.gradle's own fallback. It cannot be 0 — AGP refuses to configure
# with `versionCode is set to 0, but it should be a positive integer` — so the "this is a local
# build" marker cannot live here. What marks it is the absence of a signature, which is stated
# below, and Play refusing a reused code regardless. Low rather than high on purpose: a local build
# that guessed something like 999999 would burn the number space CI counts up through.
ANDROID_VERSION_CODE="${ANDROID_VERSION_CODE:-1}"
export ANDROID_VERSION_NAME ANDROID_VERSION_CODE
echo "version  $ANDROID_VERSION_NAME (code $ANDROID_VERSION_CODE)"

# ---------------------------------------------------------------------------------------------
# Signing. All four or none — three of four is the shape that produces a confusing Gradle failure.
# ---------------------------------------------------------------------------------------------
signing=false
if [ -n "${ANDROID_KEYSTORE_PATH:-}" ]; then
  missing=()
  for name in ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "error: ANDROID_KEYSTORE_PATH is set but ${missing[*]} is not" >&2
    echo "       Set all four or none; app/build.gradle only populates the config when the path is present." >&2
    exit 1
  fi
  [ -f "$ANDROID_KEYSTORE_PATH" ] || {
    echo "error: no keystore at $ANDROID_KEYSTORE_PATH" >&2
    exit 1
  }
  signing=true
  echo "signing  upload key at $ANDROID_KEYSTORE_PATH"
else
  echo "signing  NONE — this bundle cannot be uploaded anywhere"
fi

# ---------------------------------------------------------------------------------------------
# Build.
# ---------------------------------------------------------------------------------------------
if [ "$skip_web" = false ]; then
  echo
  echo "==> production web build"
  npm run build:prod
  echo
  echo "==> cap sync android"
  npx cap sync android
else
  echo
  echo "==> skipping the web build; android/ keeps whatever was copied into it last"
fi

echo
echo "==> bundleRelease"
(cd android && ./gradlew bundleRelease --no-daemon)

aab=android/app/build/outputs/bundle/release/app-release.aab
[ -f "$aab" ] || {
  echo "error: gradle reported success but there is no AAB at $aab" >&2
  exit 1
}

# The same check release-android.yml runs, for the same reason: an unsigned bundle uploads happily
# and is rejected by Play with a message about the certificate, long after the build went green.
if [ "$signing" = true ]; then
  unzip -l "$aab" | grep -q 'META-INF/.*\.RSA\|META-INF/.*\.EC' || {
    echo "error: signing material was supplied but the AAB carries no signature block" >&2
    exit 1
  }
  echo
  echo "signed bundle: $aab ($(du -h "$aab" | cut -f1))"
else
  echo
  echo "UNSIGNED bundle: $aab ($(du -h "$aab" | cut -f1))"
  echo "Useful for checking the bundle builds. Publishing goes through a v* tag — see docs/release.md."
fi
