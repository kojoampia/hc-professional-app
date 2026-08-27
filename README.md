# Abofonsa BridgeCare Professional — mobile app

Clinician companion app for the Abofonsa BridgeCare professional portal. Ionic + Angular 19 +
Capacitor, targeting Android and iOS.

It is a client of the live gateway at `https://professional.abofonsa.com`. It contains no server
code and is not part of the deployment bundle.

## Status

**Feature-complete for the clinician scope.** MOB1–MOB13 are merged, and the web-to-mobile port
(Phases 0–10) landed on 2026-08-22. The app ships four tabs — **Today**, **Messages**,
**Documents**, **Me** — plus five screens pushed from Today rather than made into a fifth tab:
Roster, Patients, Cases, Dashboard and own absences.

Admin surfaces, charts and the earnings screen are **deliberately absent**, not pending; the
reasoning for each is in `CLAUDE.md` § "What the app has, and what it deliberately does not".

What remains is credential-gated rather than code:

- **No store accounts or signing credentials exist yet** (MOB0), so both release workflows stop at
  a preflight naming the missing secret. `ci.yml` needs no secrets and runs on every PR.
- **iOS push is inert** — no APNs `.p8`, so that transport logs and skips. An iPhone registers a
  token the server stores and never sends to. Android push is server-verified.

Planning lives in the workspace `docs/` repo: `../docs/mobile-app-plan.md` (the `MOB<N>` work
packages) and `../docs/web-mobile-port.md` (the port, and newer where the two disagree). Both are
**records, not prompts** — where a plan and the code disagree, the code wins. Contributor guidance
is in `CLAUDE.md` / `AGENTS.md`.

## Quick start

```bash
nvm use                  # Node 22, per .nvmrc
npm ci
npm test                 # Jest
npm start                # browser at http://localhost:4300 (4200 belongs to web/)
npm run sync             # production build + copy into android/ and ios/
```

Running against a local backend needs the gateway on :5505 (see the workspace `CLAUDE.md`). The
Android emulator reaches the host at `10.0.2.2`, not `localhost` —
`src/environments/environment.development.ts` handles it.

## Native builds

```bash
npm run android          # opens Android Studio
npm run ios              # opens Xcode (macOS only)
npm run build:aab        # release AAB — unsigned unless the environment carries a keystore
```

`docs/release.md` covers the version scheme (marketing version from `package.json`, build number
from `github.run_number`) and the **three signing certificates** — debug, upload, and the app
signing key Play holds. Anything checked at runtime keys off the **app signing** fingerprint, not
the upload one; getting that backwards works for every developer and fails for every user who
installed from Play.

`npx cap sync` works on Linux for both platforms (Capacitor 8 uses Swift Package Manager, not
CocoaPods). Compiling iOS still requires macOS with Xcode.

Publishing goes through a `v*` tag and nothing else — `npm run build:aab` exercises the same build
locally but produces an unsigned bundle that uploads nowhere.
