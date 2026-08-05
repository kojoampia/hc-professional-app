# BridgeCare Professional — mobile app

Clinician companion app for the Abofonsa BridgeCare professional portal. Ionic + Angular 19 + Capacitor, targeting Android and iOS.

It is a client of the live gateway at `https://professional.abofonsa.com`. It contains no server code and is not part of the deployment bundle.

## Status

**MOB1 (repo bootstrap) — complete.** The app shell builds, tests and syncs to both native platforms. The Phase 1 features (Today / Messages / Documents / Me) land in MOB5–MOB11.

Planning lives at the workspace root in `mobile-app-plan.md`. Contributor guidance is in `CLAUDE.md` / `AGENTS.md`.

## Quick start

```bash
nvm use                  # Node 22, per .nvmrc
npm ci
npm test                 # Jest
npm start                # browser at http://localhost:4200
npm run sync             # production build + copy into android/ and ios/
```

Running against a local backend needs the gateway on :5505 (see the workspace `CLAUDE.md`). The Android emulator reaches the host at `10.0.2.2`, not `localhost` — `src/environments/environment.development.ts` handles it.

## Native builds

```bash
npm run android          # opens Android Studio
npm run ios              # opens Xcode (macOS only)
```

`npx cap sync` works on Linux for both platforms (Capacitor 8 uses Swift Package Manager, not CocoaPods). Compiling iOS still requires macOS with Xcode.

Store accounts, signing and CI are MOB0 and MOB12 and are not set up yet.
