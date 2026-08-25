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

## Version scheme

Two numbers, and they are not the same kind of thing. One is stated by a person and read by
clinicians; the other is counted by a machine and read only by the stores.

| | Source | Android | iOS | Who reads it |
| --- | --- | --- | --- | --- |
| **Marketing version** | `package.json` `version` | `versionName` | `CFBundleShortVersionString` | people — store listing, the Me tab |
| **Build number** | `github.run_number` | `versionCode` | `CFBundleVersion` | the stores, for ordering |

**The marketing version is semver and lives in exactly one place**, `package.json`. Both release
workflows read it from there and pass it to the platform build as `ANDROID_VERSION_NAME`; nothing is
typed into `build.gradle` or `Info.plist`. The tag is **checked against it and never used as the
source** — `git tag v0.2.0` on a tree that still says `0.1.0` fails the job rather than shipping a
build whose version nobody can account for.

What the parts mean for this app, which is a client of a versioned API rather than a library:

- **MAJOR** — a release a clinician must be walked through, or one that stops working against an
  older gateway. Reserve it; the four-tab shell changing shape is the kind of thing it is for.
- **MINOR** — a new screen or capability. Every port phase was one of these.
- **PATCH** — fixes and copy, including a translation correction. Store copy in four languages
  counts, since a wrong string on three locales is a defect.

**`package.json` currently says `0.1.0`, and it should say `1.0.0` before the first production
track.** `0.x` on a store listing invites the reading that this is a preview, which is the wrong
signal for a tool clinicians are told to depend on. Internal and closed-testing tracks can ship
`0.x` happily.

**Build numbers are `github.run_number`, never hand-maintained.** Play rejects a reused `versionCode`
and App Store Connect rejects a reused `CFBundleVersion`, and a counter a human has to remember to
bump is the one that blocks a release at the worst possible moment. Three things about it that are
easy to get wrong:

- **The two workflows count independently.** `release-android.yml` and `release-ios.yml` have their
  own `run_number`, so the same tag produces different build numbers on the two stores. That is
  fine — each store orders only against its own history — but never infer one from the other, and
  never quote "build 47" without saying which platform.
- **`versionCode` is what a store orders by; `versionName` is cosmetic to it.** A build with a lower
  `versionCode` cannot be published over a higher one on the same track no matter what the marketing
  version says.
- **Renaming or recreating a release workflow resets its `run_number` to 1**, and Play then rejects
  every subsequent upload as a reused or lower code, with a message about the version and nothing
  about the workflow. If either file is ever renamed, set a floor explicitly rather than letting the
  counter start over.

**Local builds get `versionCode 1`** and the same `versionName` from `package.json` — see
`scripts/build-aab.sh`. It cannot be `0`: AGP refuses to configure with `versionCode is set to 0, but
it should be a positive integer`. What marks a local bundle as unpublishable is that it carries no
signature, not its number.

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

## Signing fingerprints

**There are three signing certificates in this app's life, not one**, and confusing them produces
failures that appear only for users who installed from Play — never on the sideloaded build you
tested with.

| Certificate | Signs | Where its fingerprint comes from |
| --- | --- | --- |
| **Debug** | `assembleDebug` output | `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android` |
| **Upload** | what CI uploads to Play | `keytool -list -v -keystore upload.jks -alias <alias>` |
| **App signing** | what Play re-signs with and users install | Play Console → **Test and release → Setup → App integrity → App signing** |

With Play App Signing enrolled — and it must be, see above — Google strips the upload signature and
re-signs with the app key. So **the certificate on a device is one this repository has never seen**,
and its fingerprint is available from the Play Console and nowhere else.

**The rule: anything verified at runtime keys off the APP SIGNING fingerprint, never the upload one.**
Registering the upload fingerprint is the classic mistake, and its symptom is the worst kind — it
works for every developer and tester on a locally-signed build, and fails for every real user.

To read the fingerprint off an artefact you actually built (both forms agree; verified against a
signed bundle):

```bash
keytool -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab
keytool -list -v -keystore upload.jks -alias upload            # the same SHA-1/SHA-256
```

### What that affects here, concretely

- **Firebase and FCM push are not affected today.** `android/app/google-services.json` carries
  `"oauth_client": []` and no `certificate_hash`, and FCM v1 authenticates the *server* by its
  service-account JSON — the client's signing certificate is not part of it. Push therefore keeps
  working when Play re-signs, and there is no fingerprint to add before launch. Do not add one
  speculatively; an SHA-1 in that file is a claim that something checks it.
- **It starts mattering the moment any of these arrive**, each of which does check the certificate:
  Google Sign-In, Play Integrity or SafetyNet attestation, Firebase App Check, Dynamic Links. Add
  **both** the app signing and the upload fingerprint in the Firebase console then — the upload one
  so a locally-signed build still works for whoever is testing it.
- **App Links, if deep links are ever added.** There are none today: the manifest has a single
  LAUNCHER intent filter and no `android:autoVerify`. When they land, the SHA-256 in
  `https://professional.abofonsa.com/.well-known/assetlinks.json` must be the **app signing** one, or
  verification fails silently and links open in the browser instead of the app. That file is served
  by nginx on `webserver`, which this workspace does not own — it is a `deploy/` change plus the
  architect, not a mobile one.

Both fingerprints are public information — they identify a certificate, they are not a secret, and
the private keys behind them stay in the Play Console and GitHub secrets respectively. Recording
them in a ticket or a runbook is fine; the `.jks` is what must never be committed.

## Local builds still work unsigned

```bash
npm run build:aab            # web build + cap sync + bundleRelease
npm run build:aab -- --skip-web    # gradle only, reusing what android/ already has
```

`scripts/build-aab.sh` finds a JDK 21 itself, takes the version from `package.json`, and produces an
**unsigned** AAB — useful for checking the bundle builds, uploadable nowhere. Point it at a keystore
and it signs and then verifies the signature is actually there:

```bash
ANDROID_KEYSTORE_PATH=/path/upload.jks ANDROID_KEYSTORE_PASSWORD=… \
ANDROID_KEY_ALIAS=upload ANDROID_KEY_PASSWORD=… npm run build:aab
```

All four or none — `android/app/build.gradle` populates the signing config only when the path is
present, and three of four otherwise fails inside Gradle with a null `storeFile`, which reads as a
broken build rather than a missing variable.

**It runs no lint and no tests, deliberately.** `ci.yml` and `release-android.yml` both gate on
those and a tag is not exempt from them; a local script that repeated the gate would only make the
slow path slower.

**Gradle needs Java 21 here, and the workstation's ambient `JAVA_HOME` is 25.** Gradle's Groovy
cannot read class file major version 69 and fails with `Unsupported class file major version 69`,
which reads as a corrupt build rather than a JDK mismatch. This is separate from the toolchain pin in
`android/build.gradle` — that governs what compiles the *modules*; this is what runs Gradle itself.
The script resolves a real 21 (one with `javac`, not the compiler-less 25 JRE the workstation
defaults to) and prints which one it picked; override with `ANDROID_GRADLE_JAVA_HOME`. CI uses
Temurin 21 for the same reason.
