# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`hc-professional-app` — the **BridgeCare Professional** clinician mobile app: an Ionic + Angular + Capacitor client of the **live production gateway** at `https://professional.abofonsa.com`.

It builds no server, ships no Docker image, and is **not part of `deploy/`**. It is one more client of the same API the web dashboard uses. It lives in the `hc-professional` multi-repo workspace alongside `gateway/`, `api/`, `web/` and `deploy/`.

**The authoritative plan is `mobile-app-plan.md` at the workspace root** — scope, the `MOB<N>` work packages and their gates, and the Phase 1 backend work this app depends on. Read it before starting anything here.

### Phase 1 scope — and what is deliberately absent

Four tabs: **Today** (duty roster), **Messages**, **Documents**, **Me**. Every endpoint behind them already exists and is deployed.

**Dashboard, Patients and Cases are Phase 2 and are blocked**, not merely unbuilt: `api/` has no `Patient` entity, no `ClinicalCase` entity and no `/api/dashboard/*` endpoints, and every entity collection GET returns a bare unpaginated `List<T>` that a phone on mobile data cannot download. See `MOB-P2-PRE` in the plan. Do not start those screens.

Also deliberately out of scope: the **applicant onboarding wizard** (this app is for _active_ clinicians — any application status other than `ACTIVE`/`ROSTER_CONFIGURED` shows a link to the web portal), **composing new conversations** (no role-scoped directory endpoint exists; reply-only in v1), and **offline writes**.

## Commands

```bash
npm start                 # ng serve on :4300 — NOT 4200, which web/ already uses
npm test                  # Jest, whole suite
npx ng test --test-path-pattern="<regex>"   # ONE spec — the only form that works, same as web/
npm run lint              # eslint (flat config)
npm run prettier:format
npm run build:prod        # production bundle into dist/hc-professional-app/browser
npm run sync              # build:prod && cap sync   (run after ANY dependency or config change)
npm run android           # sync && open Android Studio
npm run ios               # sync && open Xcode (macOS only)
```

Node **22** (`.nvmrc`). Angular is pinned to **19.2.25**, byte-identical to `web/`, so services copied from there compile without adjustment.

## Non-obvious things that will cost you a day

### The dev API base URL differs per platform

There is **no same-origin relative prefix here.** Unlike `web/`, whose `ApplicationConfigService` uses `endpointPrefix = ''`, a Capacitor app has no origin to be relative to — every URL is absolute, from `src/environments/`.

The Android emulator cannot see the host's `localhost`; the host loopback is `10.0.2.2` inside the emulator. The iOS simulator shares the host's network stack, so `localhost` is correct there and in a desktop browser. `environment.development.ts` branches on `Capacitor.getPlatform()` to handle this. If requests hang on Android but work in Chrome, this is why.

### Access tokens are never persisted

`SecureTokenStore` enforces three invariants, all asserted by spec:

1. The **access token lives in a memory signal** and dies with the process. Only the **refresh token** reaches the OS keystore.
2. **Nothing is ever written to `localStorage`/`sessionStorage`.** The `@aparajita/capacitor-secure-storage` plugin ships a `SecureStorageWeb` implementation that is localStorage-backed — using it in a browser would put a long-lived credential where any script can read it. So on web (`ionic serve`, Jest, Playwright) the store **deliberately bypasses the plugin** and uses an in-memory map. Dev keeps working and the invariant holds on every platform, not just on device.
3. **A refresh token is persisted only on a device with a screen lock.** `persistRefreshToken` returns `false` and keeps the token in memory when the OS reports no lock, so the user signs in again each launch. A long-lived credential at rest is conditional on the OS having something to protect it with.

Never call `localStorage.setItem` with a token. There is a spec that will catch you.

The one thing that _does_ legitimately appear in web storage is `CapacitorStorage.hpd.deviceId` — Capacitor Preferences is localStorage-backed on web. That is a device identifier, not a credential; `PreferencesService` exists for exactly that class of value and says so.

### Sign-in, refresh and sign-out

- **Login must identify itself as a mobile client.** `AuthService.login` sends `client`/`deviceId`/`deviceName`; without `client` the gateway returns the browser's `{id_token}` and there is nothing to rotate. See the gateway's `AuthenticateController`.
- **Refresh is coalesced.** `AuthService.refresh()` shares one in-flight request. This is not an optimisation: N parallel refreshes would rotate once and then present an already-spent token, which the gateway correctly reads as **reuse** and answers by revoking the entire family. Client concurrency would look exactly like a stolen token.
- **A 401 means signed out; anything else does not.** The access token lives 15 minutes, so a 401 is the expected steady state, not a failure — `authRefreshInterceptor` refreshes once and replays. A network drop, timeout or 5xx is propagated untouched, so losing signal mid-refresh surfaces as a failed request rather than a sign-out.
- **The replayed request does not set its own Authorization header.** `authInterceptor` is registered _inside_ `authRefreshInterceptor` and re-attaches from the store, which `refresh()` has just updated. Setting it in the retry too would be overwritten anyway, and would misleadingly imply the retry controls the credential.
- **Logout order matters**: revoke server-side first (while the token is still valid), then deregister push, then wipe locally. Clearing first strands a live family on the server that nothing can revoke. It never rejects — an offline sign-out must still sign the device out.

### Navigation must go through NavController, not Router

`ion-router-outlet` keeps every page it has shown so it can animate back. Plain
`Router.navigateByUrl` tells it nothing about stack intent, so pages accumulate and
stay painted on top of each other — the symptom is a screen that renders correctly
in the DOM while an older one covers it. **Use `NavController.navigateRoot()` when
moving between app areas** (sign-in, sign-out, boot). Two related requirements:

- `{ provide: RouteReuseStrategy, useClass: IonicRouteStrategy }` must be in
  `app.config.ts`. A single-route app works without it, so it is easy to omit and
  only breaks once there is a real stack.
- **Unlocking is not a route.** `SessionBootstrapper` makes the cold-start decision
  behind the app shell's splash and the router is told exactly once where to go. As
  an `/unlock` page it made the first navigation a guard redirect that then navigated
  again from its own `ngOnInit`, racing the outlet's first transition — the unlock
  spinner ended up sitting over the login form, which sat over Today.

### The offline cache

- **Cached data is always served.** The TTL decides what the UI _says_, never whether
  the cache is readable. A roster that vanishes when the signal does is worse than
  useless — the data is still correct, just old. `error` is reachable only when there
  is nothing cached at all.
- **Whole-collection replace.** `api/` has no ETags, no pagination and no
  `X-Total-Count`, so there is nothing to diff. Every fetch returns a complete list
  and is written whole; no merge, no partial state.
- **`setSensitive` seals with AES-GCM** under a key kept in the OS keystore next to
  the refresh token — so `SecureTokenStore.clear()` destroys it, and a cache whose key
  is gone is unreadable even if rows survive the wipe. Roster and document metadata
  stay in the clear so the shell can render before the keystore is unlocked.
- **`CACHE_VERSION` is the substitute for schema migrations.** Bump it by hand
  whenever a cached DTO changes; a mismatch on boot clears everything.
- **The cache is wiped when a different account signs in.** Two clinicians sharing a
  ward device is ordinary; serving one the other's cached roster would be a data leak
  wearing the costume of a performance optimisation.
- The offline interceptor short-circuits **GETs only**. There is no offline write
  queue, so a mutation must fail visibly rather than vanish into a synthetic error.

### jsdom has no `crypto.subtle`

`src/setup-jest.ts` installs Node's real WebCrypto. Mocking it instead would make the
"unreadable at rest" assertions prove only that a mock was called. On device the
WebView has SubtleCrypto because `androidScheme: 'https'` makes it a secure context.

### `ng serve` cannot talk to production, by design

The gateway's prod CORS allowlist is `capacitor://localhost`, `https://localhost` and `ionic://localhost`. A browser at `http://localhost:4300` is **not** on it and never will be — adding it would weaken the guarantee that the deployed web app's single-origin posture is untouched. So pointing the dev build at `professional.abofonsa.com` and opening it in Chrome gets a CORS failure, which is correct behaviour, not a bug. For local development run the gateway locally on :5505; for on-device testing the Capacitor origin is allowlisted and works.

### Every Capacitor plugin goes behind a wrapper

All native access lives in `src/app/core/native/`: `BiometricService`, `SecureTokenStore`, `PushService`, `CameraService`, `ShareService`, `NetworkService`.

**Components and specs must never import `@capacitor/*` or `@aparajita/capacitor-*` directly** — there is an eslint `no-restricted-imports` rule enforcing it, with a narrow allowlist for the wrappers themselves, `diagnostics.page.ts`, the environments and `capacitor.config.ts`. This is what makes the app unit-testable without a device, lets Playwright stub four services instead of a plugin layer, and keeps a plugin swap to one file — which matters, because `@aparajita/*` is single-maintainer (substitute: `capacitor-native-biometric`).

### The style pipeline

`src/global.css` is **plain CSS, not SCSS** — Tailwind v4 is CSS-first, the BridgeCare token block is nothing but custom properties, and Dart Sass has deprecated `@import`. Component styles are still SCSS; that is independent.

Three rules that are load-bearing:

1. **`src/theme/tailwind.css` imports only `tailwindcss/theme` and `tailwindcss/utilities`** — never the `tailwindcss` bundle, which pulls in preflight. Ionic ships its own reset (normalize/structure/typography); Tailwind preflight on top breaks `ion-*` sizing and button styling. `web/` has the same constraint and gets it right — copy the import pair exactly, do not "tidy" it into one import.
2. **The Ionic dark palette import is deliberately absent** from `global.css`. The Ionic starter includes `@ionic/angular/css/palettes/dark.system.css`; leaving it in makes iOS/Android dark mode invert the whole navy/cream system. **This app is light-mode only**, matching `web/`. Do not restore it. Verify by putting the simulator in dark mode — it must render identically to light.
3. **Ionic's optional utility sheets are not imported.** Tailwind owns utilities. Use `px-4`, not `ion-padding`. Two utility systems at the same specificity is what produced the long-running override fights documented in `web/professional-web.md`.

Unlike `web/`, Tailwind is wired through a plain `.postcssrc.json` — `web/`'s custom-webpack hook exists only because of the JHipster layout and is not needed here.

### Ionic theming traps (MOB2)

- **`--ion-color-*-rgb` must be literal triplets**, never `var()`. Ionic does colour maths on them and cannot resolve `var()` inside `rgba()`.
- **`--ion-color-gold-contrast` must be `#3a2a08`, never `#ffffff`.** White on gold is 2.74:1 and fails AA. That token is how the never-white-on-gold rule is enforced _inside_ Ionic components — `ion-button`/`ion-chip`/`ion-badge` derive their text colour from it. There is a contrast spec asserting this.
- **Ionic mode stays at the platform default** (`ios` on iOS, `md` on Android). Forcing one mode everywhere is the classic "this is a webview" tell. The token layer is mode-independent, so the cost is visual QA on two platforms, not rework. Do not "simplify" this to a single mode.

### Jest and Ionic ESM

`@ionic/angular`, `@stencil`, `ionicons`, every `@capacitor/*` and `@aparajita/*` package, and `idb-keyval` are ESM-only. `jest.config.js` whitelists them in `transformIgnorePatterns`. Without that, the very first spec dies with `SyntaxError: Cannot use import statement outside a module`, which looks like a broken test rather than a transform-config problem.

### `cap sync` works on Linux

Capacitor 8 uses Swift Package Manager for iOS rather than CocoaPods, so `npx cap sync` succeeds on Linux for both platforms. **Building** iOS still requires macOS + Xcode; syncing does not.

## Design tokens are COPIED, not shared — the drift log

Per the plan's accepted trade-off, this repo copies from `web/` rather than sharing a package. When either side changes, both must change. Record every copy here with the `web/` commit it came from.

| Copied into `mobile/`                    | From `web/src/main/webapp/`                 | `web/` commit | Copied on  | Notes                                                                                                                    |
| ---------------------------------------- | ------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/theme/hpd-tokens.css` `:root`       | `content/scss/global.scss` L37-81           | `48a12fc`     | 2026-08-05 | Verbatim, plus one mobile-only addition: `--hpd-color-on-gold: #3a2a08`                                                  |
| `src/theme/hpd-components.css`           | `content/scss/global.scss` L99-113, 227-312 | `48a12fc`     | 2026-08-05 | Dropped `@media print`, `::-webkit-scrollbar`, `.hpd-auth-brand`. Added `.hpd-btn-block`, `.hpd-safe-*`, 44px min-height |
| `src/theme/tailwind.css` `@theme`        | `content/css/tailwind.css`                  | `48a12fc`     | 2026-08-05 | Omitted the `--color-hpd-on-navy-*` sidebar aliases and chart series; added `--color-hpd-on-gold`                        |
| `src/global.css` body/form-control rules | `content/scss/global.scss` L167-185         | `48a12fc`     | 2026-08-05 | The font-inherit rule for form controls is required for the same reason as in `web/` — preflight is not imported         |

**When `web/`'s token block changes**, diff it against `hpd-tokens.css` and update both this table and the file. `hpd-theme.spec.ts` will catch a contrast regression but it cannot know that `web/` moved.

Restating the `web/` design rules that apply verbatim: **never raw hex, never stock Tailwind palette classes** (`slate-*`, `indigo-*`, …) — colours come from `--hpd-*` tokens; **one font, Inter**, self-hosted here (not Google Fonts, so a cold start in airplane mode does not fall back to a system font); **light mode only**; **never white text on gold**.

## Layout

```
src/app/
  app.routes.ts          # '' → diagnostics for now; MOB5 adds unlock/login, MOB6+ the tabs
  core/native/           # the six Capacitor wrappers — the ONLY place plugins are imported
  shell/diagnostics.page.ts   # MOB1 bootstrap probe; replaced by the Today tab in MOB6
src/environments/        # absolute API base URLs, per platform
src/theme/               # variables.css (Ionic mapping), tailwind.css
capacitor.config.ts      # appId com.abofonsa.bridgecare.professional, androidScheme https
```

`androidScheme: 'https'` is explicit in `capacitor.config.ts` though it is the Capacitor default, because two things depend on it: the gateway CORS allowlist must contain `https://localhost` (**not** `http://localhost`) for Android, and a secure context is what makes `crypto.subtle` — the MOB6 cache encryption — and the camera available.

## Backend dependencies not yet built

This app cannot reach its Phase 1 gates until the backend work in `mobile-app-plan.md` lands:

- **Refresh tokens** (`gateway/`, MOB3) — there is no refresh flow today, only a single 24 h / 30 d HS512 token.
- **CORS** (`gateway/`, MOB4) — production is single-origin by design and currently emits no CORS headers at all. This app is the first client ever to need them.
- **`spring.servlet.multipart.max-file-size`** (`api/`, MOB4) — unset, so Spring's 1 MB default fires before the documented 5 MB check. Camera captures land squarely in the broken range.
- **Device-token registry + FCM sender + Kafka push consumer** (`api/`, MOB9) — no push infrastructure exists at all.
