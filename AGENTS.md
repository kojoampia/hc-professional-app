# AGENTS.md

`CLAUDE.md` in this directory is the full guide — read it first. This file is the short version plus the invariants that must not be broken.

## What this is

`hc-professional-app` — the BridgeCare Professional clinician mobile app (Ionic + Angular 19 + Capacitor), a client of the live `https://professional.abofonsa.com` gateway. No server, no Docker image, not part of `deploy/`.

The authoritative plan is **`mobile-app-plan.md` at the workspace root** (`MOB<N>` work packages and their gates).

## Invariants

1. **Never persist an access token.** Memory only. Only the refresh token reaches the OS keystore, and never `localStorage`/`sessionStorage` on any platform. `SecureTokenStore` enforces this; specs assert it.
2. **Never import `@capacitor/*` or `@aparajita/capacitor-*` outside `src/app/core/native/`.** An eslint rule enforces it. Wrappers exist so the app is testable without a device and a plugin swap is one file.
3. **Never restore the Ionic dark palette import.** Light mode only. Dark mode must render identically to light.
4. **Never import the `tailwindcss` bundle** — only `tailwindcss/theme` and `tailwindcss/utilities`. Preflight breaks Ionic components.
5. **Never use white text on gold** (`#c59437`) — 2.74:1, fails AA. Use `#3a2a08`. `--ion-color-gold-contrast` is how this is enforced inside Ionic components.
6. **Never use raw hex or stock Tailwind palette classes.** Colours come from `--hpd-*` tokens.
7. **`--ion-color-*-rgb` must be literal triplets**, never `var()`.
8. **Do not start Dashboard / Patients / Cases.** They are Phase 2 and blocked on backend work (`MOB-P2-PRE`).
9. **Record every file copied from `web/` in the drift log** in `CLAUDE.md`, with the source commit.

## Commands

`npm start` · `npm test` · `npx ng test --test-path-pattern="<regex>"` (single spec) · `npm run lint` · `npm run sync` · `npm run android` · `npm run ios`

Node 22 (`.nvmrc`). Angular pinned to 19.2.25 to match `web/`.
