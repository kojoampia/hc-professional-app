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

## MOB5+ — added as each work package lands

_(Auth shell, roster, messages, documents/camera, push. Each MOB adds its steps here as part of its gate.)_
