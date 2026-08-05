# Device smoke checklist

Run on **one physical iPhone and one physical Android device** before every release tag. Playwright covers routing, guards, interceptors and state against the web build; this list covers what it cannot reach.

Cheaper and more honest than an Appium rig — see `mobile-app-plan.md` § Testing. If this becomes a bottleneck, Appium/WebdriverIO is the named escalation.

## MOB1 — bootstrap (available now)

1. App installs and launches to the Diagnostics screen without a crash.
2. **Platform** row reads `ios` / `android` and **Native** reads `true`.
3. **API base** row shows the expected host for the build (dev vs production).
4. **Network** row reads `online`; enable airplane mode, relaunch, and it reads `offline`.
5. **Device protection** reads `biometry` on an enrolled device, `device-credential` on a passcode-only device, `none` on a device with no lock.
6. **Push** reads `supported`.
7. **Secure store** reads `reachable, empty`.
8. **Share sheet** reads `available`.
9. Put the OS in **dark mode** and relaunch — the screen must render **identically to light mode**. Any inversion means the Ionic dark palette import came back.
10. Status bar text is legible against the toolbar in both orientations.

## MOB2 — design system

Open `/theme` (the design-system gallery).

11. Toolbar is cream `#f7f4ee` with dark ink; the page behind it is `#f2f0ea`.
12. **Gold buttons and the gold badge show DARK text**, never white. This is the AA rule — white on gold is 2.74:1.
13. Primary buttons are navy `#0d3058` with white text; ghost buttons are white with a `#e6e2d9` border.
14. Cards are white with a 14px radius and a soft navy-tinted shadow — not a grey box shadow.
15. Every button is at least 44px tall; tap each one with a thumb, not a fingernail.
16. Tap **Sheet** — it rises from the bottom to half height, has a swipe handle, dismisses by swiping down, and its top corners are visibly rounder (20px) than the cards.
17. Text renders in Inter, including inside `<input>` and `<button>` — compare the "Native input" placeholder with the surrounding body copy; a different face there means the form-control font-inherit rule was lost.
18. **Put the device in dark mode and reopen.** The screen must be pixel-identical to light mode. Any inversion means the Ionic dark palette import came back.
19. Turn off wifi and mobile data, force-quit, relaunch. Text still renders in Inter, not a system font — the font is bundled, not fetched.
20. Rotate to landscape: nothing clips, the toolbar keeps its safe-area inset.

## MOB5 — auth shell

Needs a real account on `professional.abofonsa.com`.

21. Cold start with nothing stored lands on the **sign-in** screen, not a spinner.
22. Sign in with correct credentials → reaches the signed-in screen, which shows your login and authorities.
23. Sign in with a **wrong password** → "That username and password did not match." Sign in with the **device in airplane mode** → "Could not reach BridgeCare." The two messages must differ; conflating them makes a network blip look like a lockout.
24. Force-quit and relaunch → biometric prompt appears, and unlocking reaches the signed-in screen **in under 2 seconds** without retyping a password.
25. Cancel the biometric prompt → "Use password" path reaches the sign-in screen.
26. Fail biometrics three times → the stored session is discarded and you must sign in with a password.
27. **Turn airplane mode on, then force-quit and relaunch.** You must get "could not reach the server / your session is still valid" with a **Try again** button — *not* a sign-out. Turn the network back on, tap Try again, and you land signed in. This is the single most important step here: a transient network failure must never discard a valid session.
28. Leave the app backgrounded for more than 5 minutes, return → biometric prompt again.
29. **On a device with no screen lock at all** (remove the PIN in system settings): sign in, force-quit, relaunch → you are asked for your password again, and the sign-in screen explains why. The refresh token must not have been stored.
30. Sign out from the signed-in screen → returns to sign-in; force-quit and relaunch → still signed out.
31. After signing out, sign in again on a **second device**, then use the first one: both work independently (sessions are per-device).

## MOB6+ — added as each work package lands

_(Roster, messages, documents/camera, push. Each MOB adds its steps here as part of its gate.)_
