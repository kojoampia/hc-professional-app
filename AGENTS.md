# AGENTS.md

`CLAUDE.md` in this directory is the full guide — read it first. This file is the short version plus the invariants that must not be broken.

## What this is

`hc-professional-app` — the Abofonsa BridgeCare Professional clinician mobile app (Ionic + Angular 19 + Capacitor), a client of the live `https://professional.abofonsa.com` gateway. No server, no Docker image, not part of `deploy/`.

Two plans, both in the workspace `docs/` repo — they moved out of the workspace root on 2026-08-08, because the root is not a git repository. **`../docs/mobile-app-plan.md`** holds the `MOB<N>` work packages and their gates; **`../docs/web-mobile-port.md`** is the web-to-mobile port (Phases 0–10) and is newer where the two disagree. Both are **records, not prompts** — where a plan and the code disagree, the code wins.

Releasing is `docs/release.md` in this repo: the three workflows, the version scheme, and the signing fingerprints.

## Invariants

0. **The brand is "Abofonsa BridgeCare", never "BridgeCare" alone.** This product is
   "Abofonsa BridgeCare Professional". Where a caption is genuinely space-constrained
   (launcher label, system dialog title), use **"Abofonsa"** — never the bare
   "BridgeCare". See CLAUDE.md § The brand name.
1. **Never persist an access token.** Memory only. Only the refresh token reaches the OS keystore, and never `localStorage`/`sessionStorage` on any platform. `SecureTokenStore` enforces this; specs assert it.
2. **Never import `@capacitor/*` or `@aparajita/capacitor-*` outside `src/app/core/native/`.** An eslint rule enforces it. Wrappers exist so the app is testable without a device and a plugin swap is one file.
3. **Never restore the Ionic dark palette import.** Light mode only. Dark mode must render identically to light.
4. **Never import the `tailwindcss` bundle** — only `tailwindcss/theme` and `tailwindcss/utilities`. Preflight breaks Ionic components.
5. **Never use white text on gold** (`#c59437`) — 2.74:1, fails AA. Use `#3a2a08`. `--ion-color-gold-contrast` is how this is enforced inside Ionic components.
6. **Never use raw hex or stock Tailwind palette classes.** Colours come from `--hpd-*` tokens.
7. **`--ion-color-*-rgb` must be literal triplets**, never `var()`.
8. **Do not add an admin surface, a chart, or the earnings screen.** Dashboard, Patients and Cases
   shipped with the port and this invariant no longer bars them — what it bars now is scope. This
   is a clinician app; admins use the web portal, charts are unreadable at 390px, and earnings come
   from `adminservice` outside this workspace. See CLAUDE.md § "What the app has, and what it
   deliberately does not", which gives the decision behind each omission.
9. **Record every file copied from `web/` in the drift log** in `CLAUDE.md`, with the source commit.
10. **Never ship a string in fewer than four languages.** The app publishes in
    English, Spanish, French and German — every release, every screen, and the store
    listings too. A user-visible string is added to all four catalogues in the same
    change; there is no "English now, translations later" state, because that state
    is indistinguishable from a bug on three locales. ngx-translate renders a missing
    key as the key itself — nothing throws, nothing logs, and the English build looks
    perfect — so `catalogues.spec.ts` is the gate rather than review. See CLAUDE.md
    § The app ships in four languages.

## Commands

`npm start` · `npm test` (**behaviour, not types** — `ts-jest` transpiles; `npx ng build` is the type gate, see `CLAUDE.md` § Commands) · `npx ng test --test-path-pattern="<regex>"` (single spec) · `npm run lint` · `npm run sync` · `npm run android` · `npm run ios` · `npm run build:aab`

**Publishing goes through a `v*` tag and nothing else.** `npm run build:aab` runs the release build locally and produces an **unsigned** bundle unless the environment already carries all four `ANDROID_KEYSTORE_*`/`ANDROID_KEY_*` variables — useful for checking the bundle builds, uploadable nowhere. It deliberately runs no lint and no tests; `ci.yml` and `release-android.yml` gate on those and a tag is not exempt.

Node 22 (`.nvmrc`). Angular pinned to 19.2.25 to match `web/`.

**The Android build needs no `JAVA_HOME`** — `android/build.gradle` pins a Java 21 toolchain for every module, so `./gradlew assembleDebug` works even though the workstation default is a JRE with no `javac`. Do not "fix" a Gradle JDK error by exporting `JAVA_HOME`; change the pin instead, and keep it at whatever `@capacitor/android` compiles against. See `CLAUDE.md § The Android build pins its own JDK`. The Maven builds in `gateway/` and `api/` have no equivalent pin and do still need it set.
