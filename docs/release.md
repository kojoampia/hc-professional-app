# Releasing

Three workflows, in `.github/workflows/`:

| Workflow | Runner | Trigger | What it does |
| --- | --- | --- | --- |
| `ci.yml` | ubuntu | every PR, push to `main` | lint, prettier, 374 tests, prod build, `cap sync`, locale check |
| `release-android.yml` | ubuntu | tag `v*` | signed AAB → Play internal track |
| `release-ios.yml` | macos-14 | tag `v*` | `match` → `gym` → TestFlight |

`ci.yml` needs **no secrets** and runs today. Both release workflows are **blocked on credentials
that do not exist yet** (MOB0) and stop at a preflight naming exactly which secret is missing.

## Cutting a release

```bash
# 1. bump the marketing version — this is the single source of it
npm version 0.2.0 --no-git-tag-version
git commit -am "Release 0.2.0" && git push

# 2. tag it; both release workflows fire on the same tag
git tag v0.2.0 && git push origin v0.2.0
```

The tag and `package.json` must agree — both workflows check and fail loudly if they do not, rather
than publishing a build whose version nobody can account for.

**Build numbers are `github.run_number`**, never hand-maintained. Play rejects a reused
`versionCode` and App Store Connect rejects a reused `CFBundleVersion`, and a counter a human has to
remember to bump is the one that blocks a release at the worst possible moment.

## The secrets each release workflow needs

None of these exist yet. They are MOB0 prerequisites, not part of MOB12.

### Android — 5 secrets

| Secret | What it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the upload keystore, `base64 -w0 upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | its store password |
| `ANDROID_KEY_ALIAS` | the alias inside it |
| `ANDROID_KEY_PASSWORD` | that alias's password |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play service account with *Release to testing tracks* |

**Enrol in Play App Signing.** These sign the *upload*; Google holds the real app key. If the upload
key is lost Google can reset it. If the app key were lost and Google did not hold it, the listing
could never be updated again and a new one would have to be published under a new package name.

### iOS — 6 secrets

| Secret | What it is |
| --- | --- |
| `APP_STORE_CONNECT_KEY_ID` | API key id |
| `APP_STORE_CONNECT_ISSUER_ID` | issuer id from the same page |
| `APP_STORE_CONNECT_KEY_P8` | the `.p8` private key, base64 |
| `MATCH_GIT_URL` | private repo holding encrypted certificates |
| `MATCH_PASSWORD` | passphrase for those |
| `MATCH_GIT_BASIC_AUTHORIZATION` | token that can read that repo |

> **The two `.p8` files are different keys.** MOB9 needs an **APNs** auth key for push; this needs an
> **App Store Connect API** key for publishing. Same extension, different pages of the developer
> portal, and neither substitutes for the other. Both are outstanding.

`match` is used rather than a hand-exported `.p12` because it keeps certificates in a private
encrypted repo that a laptop and a runner read identically. A certificate base64'd into a secret
works exactly once, expires silently after a year, and is renewed by whoever remembers the steps.

## Nothing signing-related may enter this repository

**It is public.** Commits are mirrored and indexed within minutes and are not retractable by
deletion. `*.keystore`, `*.jks` and `*.p8` are gitignored, but that is the second line of defence —
the first is that `android/app/build.gradle` reads signing material from the **environment** only,
so there is no file for anyone to add.

## Local builds still work unsigned

The signing config populates only when `ANDROID_KEYSTORE_PATH` is set, so on a machine with no
credentials:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64   # Gradle cannot run on 25 — see below
npm run build:prod && npx cap sync android
cd android && ./gradlew bundleRelease
```

produces an unsigned AAB. Useful for checking the bundle builds; it cannot be uploaded anywhere.

**Gradle needs Java 21 here, and the workstation's ambient `JAVA_HOME` is 25.** Gradle's Groovy
cannot read class file major version 69 and fails with `Unsupported class file major version 69`,
which reads as a corrupt build rather than a JDK mismatch. This is separate from the toolchain pin in
`android/build.gradle` — that governs what compiles the *modules*; this is what runs Gradle itself.
CI uses Temurin 21 for the same reason.
