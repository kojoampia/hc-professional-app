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
23. Sign in with a **wrong password** → "That username and password did not match." Sign in with the **device in airplane mode** → "Could not reach Abofonsa BridgeCare." The two messages must differ; conflating them makes a network blip look like a lockout.
24. Force-quit and relaunch → biometric prompt appears, and unlocking reaches the signed-in screen **in under 2 seconds** without retyping a password.
25. Cancel the biometric prompt → "Use password" path reaches the sign-in screen.
26. Fail biometrics three times → the stored session is discarded and you must sign in with a password.
27. **Turn airplane mode on, then force-quit and relaunch.** You must get "could not reach the server / your session is still valid" with a **Try again** button — _not_ a sign-out. Turn the network back on, tap Try again, and you land signed in. This is the single most important step here: a transient network failure must never discard a valid session.
28. Leave the app backgrounded for more than 5 minutes, return → biometric prompt again.
29. **On a device with no screen lock at all** (remove the PIN in system settings): sign in, force-quit, relaunch → you are asked for your password again, and the sign-in screen explains why. The refresh token must not have been stored.
30. Sign out from the signed-in screen → returns to sign-in; force-quit and relaunch → still signed out.
31. After signing out, sign in again on a **second device**, then use the first one: both work independently (sessions are per-device).

## MOB6 — Today and the offline cache

32. After signing in you land on **Today**, not a diagnostics screen.
33. The shift card's heading and its body describe the **same** shift — if it says "Next shift", the details underneath must be that shift, not one that finished earlier today.
34. The window shown matches the roster: MORNING 06:00–14:00, AFTERNOON 14:00–22:00, NIGHT 22:00–06:00, DAY 08:00–17:00. A FLEXIBLE day shows no window at all.
35. **During a night shift, after midnight**, the card still reads "On duty" — the NIGHT window wraps, and this is the case a naive same-date check gets wrong. Worth timing a check for.
36. "Next 7 days" shows only the coming week; nothing further out appears.
37. An expiring licence appears under "Needs attention" with days remaining; a lapsed one shows a red **lapsed** badge. A certificate expiring does **not** appear — only licences cost you access.
38. Pull down to refresh; the list updates and any staleness banner clears.
39. **Turn on airplane mode and reopen Today.** The roster is still there, with a banner reading "Offline — showing saved data · updated N ago". It must not be blank and must not error.
40. Still offline, pull to refresh: the banner stays, the data stays. Nothing disappears.
41. Come back online and refresh: the banner clears.
42. Sign out, then inspect the app's storage (Android Studio Device Explorer / Xcode container). There must be **no** Abofonsa BridgeCare cache rows left.
43. Sign in as a **different clinician** on the same device: you see their roster immediately, never the previous user's.

## MOB7 — Messages and the live socket

Needs a second account (or the web dashboard) to send from.

44. Open **Messages**: threads are listed newest first, with the unread count as a gold badge in the toolbar.
45. Tap a thread: it opens as a bottom sheet. Your own messages sit right-aligned in navy; everyone else's are left-aligned in white.
46. **Send a message from the web dashboard to this clinician while the app is open and on the Messages screen.** It must appear within about 2 seconds without any manual refresh. This is the whole point of the socket — if it does not arrive, check that nginx is forwarding `Upgrade` on `/websocket` rather than assuming the app is at fault.
47. Reply from the phone; the message appears in the thread and the web dashboard shows it.
48. Reply with **airplane mode on**: an error appears under the box and **your draft is not lost**. There is no offline send queue, so it must fail visibly.
49. Background the app for under 30 seconds and return — messages still arrive live, with no reconnect delay.
50. Background it for more than a minute, return, and send a message from the web: the unread count is correct on resume and the socket is live again.
51. **Leave the app open and idle for more than 15 minutes**, then have someone send a message. It must still arrive — the access token has rotated by then and the socket has to reconnect with the new one. This is the failure that looks like "messages just stopped working after a while".
52. Sign out: the socket closes. Watch the server logs if you can — nothing should keep dialling with the revoked token.
53. Open a thread while offline: previously read messages are still there.

## MOB8 — Documents and camera

54. Open **Documents**: your documents list with type, expiry and a verification badge (pending amber, verified green, rejected red).
55. From **Today**, tapping an expiring licence takes you here — the warning has to be actionable.
56. Tap **Add or renew**, choose LICENSE, and try to continue **without an expiry date**: it is refused locally, with a clear reason. The server would reject it anyway; this saves a round trip and an opaque 400.
57. Choose OTHER without a label: likewise refused.
58. **Take a photo of a licence on an iPhone.** iOS captures HEIC; it must upload successfully and appear as **pending**. If it fails, the re-encode is not running — the server takes only PDF/PNG/JPEG and checks magic bytes.
59. Progress renders during the upload, not a static spinner. On a ward's signal a 3 MB upload takes long enough that a frozen spinner reads as a hang and people retry, producing duplicates in the review queue.
60. **Take a photo somewhere with location services on, then have an administrator download it from the review queue and inspect its EXIF.** There must be **no GPS tags and no camera metadata**. This is the one step that cannot be checked from the phone.
61. Photograph a document in **portrait**: it must appear upright in the review queue, not rotated.
62. Upload a **PDF** from the file picker: it goes through unchanged and keeps its filename.
63. Try to pick a **HEIC or WebP** from the library: refused with "Only PDF, PNG and JPEG", not a server error.
64. Try a **PDF over 5 MB**: refused locally with a size message.
65. Photograph something very large and detailed (a dense page in bright light). It should still upload — and if it genuinely cannot be compressed enough, the message must suggest reframing, not quote bytes.
66. Upload with **airplane mode on**: fails visibly with a retry, and nothing is silently queued.
67. First camera use prompts for permission with **Abofonsa BridgeCare-specific wording** about photographing licences — not a generic string.

## MOB10 — push in the app

Needs **two accounts** and a second client (the web dashboard) to send from. Steps 76–79 are the MOB9
gate items too — they could never be checked before the client registered a token at all. **On iOS,
everything here is blocked until an APNs `.p8` exists**: that transport logs and skips, so an iPhone
registers a token the server stores and never sends to.

68. Sign in on a fresh install and **accept** the notification permission prompt. It appears on first
    reaching the tab bar, not on the login screen.
69. In Mongo, `db.device_token.find({accountId: "<login>"})` shows one row with `platform`,
    `appVersion` and **`langKey` matching the app's current language** — not null. A null `langKey`
    means the registration went out before the language was resolved.
70. Change the language on the Me tab. The **same** row's `langKey` updates within a second; no
    second row appears.
71. Background the app, wait past the 30 s socket grace period, and have the other account send a
    message. **Exactly one** tray row appears — not two, which would mean the socket also fired.
72. Tap it. The app opens **the thread that message is in**, not the inbox and not Today.
73. Send three more messages to the same thread while backgrounded. They **collapse into one tray
    row**, not four.
74. With the app **open on the Messages tab**, receive a message: the badge and list update and **no
    tray row appears at all**.
75. With the app open on **Today**, receive a message: the Messages tab badge increments, still with
    no tray row.
76. Turn **New messages** off on the Me tab, then have the other account send one. No tray row, and
    the badge still updates when the app is next opened — the preference silences push, not the app.
77. With **Show who sent it** off (the default), a tray row says "New message" and **names nobody**.
    Turn it on and the next one names the sender.
78. Set the device language to German, sign in again, and receive a message: the tray text is
    **German**, including the sender line. Repeat for Spanish and French. This is the gate item the
    old loc-key design silently failed on every locale.
79. Sign out. `db.device_token.find({token: "<that token>"})` returns **nothing** — the row is
    deleted, not merely disabled.
80. Sign in as a **different clinician on the same handset** and have the first account be sent a
    message. Nothing arrives on this phone. This is the reassign-on-conflict path, and getting it
    wrong delivers one clinician's notifications to another.
81. Sign out with **airplane mode on**. The app still signs out, and the stale row is pruned the
    first time a send to it fails.
82. Sign in as a **carer, angel, chemist or technician** — a read-only role — and confirm the device
    registers and the preference toggles save. Under the `POST|PUT /api/**` rules these would 403
    silently, and the clinician would simply never be notified, with nothing to point at.

## Phase 4 — roster calendar and own time off

Needs a rostered account and, for steps 88–89, an administrator to approve leave from the web
portal. Steps 84 and 90 are the ones that cannot be checked any other way.

83. Today shows an **Open my roster** button; tapping it pushes the calendar and the back button
    returns to Today rather than exiting the app.
84. **Days with a shift are navy; days on leave are gold with DARK ink.** White on gold is 2.74:1
    and fails AA — if the gold days read white, the mark colours have drifted from the tokens.
85. A day that is **both rostered and on leave** shows as leave and still appears in the roster —
    neither mark suppresses the other. That is the day an administrator needs to see.
86. Tap a rostered day: the round, its shift window and each visit's time and customer appear.
87. **Turn airplane mode on and tap a day.** The calendar marks and the leave list still render from
    cache; the day view says it needs a connection. It must NOT show a previously-opened day's
    rounds — that read refreshes visit snapshots server-side, so a cached copy would be both stale
    and a skipped write.
88. Request time off for a future range. It appears immediately as **Requested**, in gold.
89. Have an administrator approve it on the web portal, pull to refresh, and it reads **Approved**
    in green.
90. Request time off with **airplane mode on**: it refuses visibly and says so before sending.
    Nothing is queued — there is no offline write queue yet, and a mutation must fail loudly rather
    than vanish into a synthetic success.
91. Set the device to German, reopen the calendar: month and weekday names are German, and so are
    the absence dates. `ion-datetime` localises through `LOCALE_ID`, which ngx-translate does not
    touch — English month names beside German copy means that binding was lost.
92. Repeat step 91 in Spanish and French.
93. An **EVENING** shift shows a window of 15:00–23:00 and, during it, Today reads "On duty until
    23:00". Before 2026-08-22 this shift had no window at all and Today called it off duty.

## Phase 2 — the offline write queue

The queue holds clinical content, so most of these cannot be checked in a browser. Steps 96 and 99
are the two that matter most: one proves nothing is lost, the other proves nothing is duplicated.

94. Request time off with **airplane mode on**. It is accepted and shows as pending rather than
    refused — this is the behaviour Phase 4 shipped without and that this phase replaces.
95. Restore signal. It sends within a second or two without being asked.
96. **Queue something offline, force-quit the app, relaunch, THEN restore signal.** It still sends.
    A queue that only survives while the process does is not a queue.
97. With something queued, inspect the app sandbox (Device Explorer / Xcode container). The stored
    row must be **unreadable** — no note text, no patient name in plaintext.
98. Queue something and wait past ten minutes with no signal: the shell says so. Under ten minutes
    it stays quiet — a clinician in a lift does not need a banner.
99. **Kill the app mid-send** (airplane mode on at the moment the spinner appears), relaunch, let it
    retry. The entry must appear in the record **once**. This is the `clientRef` path, and a
    duplicated observation is invisible until someone reads the record back.
100.  Have an administrator change the same case from the web portal, then send a queued edit to it.
      It stops as a conflict and says who to re-apply against — it must **not** silently overwrite.
101.  Sign out with something queued. A dialog appears offering **Send now** and **Discard and sign
      out**; cancelling leaves you signed in. Choosing _Send now_ with no signal must not sign you
      out.
102.  Choose **Discard and sign out**, sign back in, and confirm the queue is empty — the entries are
      genuinely gone, not hiding.
103.  Sign in as a **different clinician on the same handset** with the first one's entry queued. The
      queue is empty for the second clinician: the cache key is destroyed on account change, and one
      clinician's unsent note must never surface in another's session.
104.  Repeat step 94 in German and confirm the pending and "not sent" copy is translated.

## Phase 5 — patients, read-only

Needs an account with more than 20 patients for steps 106–108; without one the paging cannot be
seen at all, and a directory that silently shows only the first page is exactly what this phase
exists to make visible.

105. Today shows **My patients**; tapping it pushes the directory and the back button returns.
106. Scroll to the bottom: more rows load without a pagination control anywhere on screen.
107. Keep scrolling past three pages, background the app, resume — the list is still where it was.
108. Scroll to the very end: loading stops rather than looping. The count that stops it is the
     server's match count, not the number of rows on screen.
109. Type a name in the search bar. The list narrows **from the server** — watch the request, not
     just the result: filtering in the browser would still look right on a small caseload.
110. Search for something with no matches: it says no patients match, not that you have none. Clear
     the search and confirm the full list returns.
111. Tap each segment (All / Female / Male / Children) and confirm the list changes and the search
     text is kept.
112. Tap a patient: the record opens full-screen with contact details, cases, activity and reports.
113. **Turn airplane mode on and reopen the directory.** The first page still renders from cache and
     the banner says so. Scrolling for more does nothing rather than emptying the list.
114. **Still offline, open a patient you opened earlier.** The record renders from cache with the
     "saved on this phone" note. Open one you have NOT opened before: it says it could not load.
115. Inspect the app sandbox with something queued and records cached. Neither the directory nor any
     record may be readable — no patient names, no diagnoses in plaintext.
116. Open 21 different patients, then go offline and try the first one. It is gone, by design: the
     cache keeps the 20 most recently opened so a long career cannot fill the sandbox.
117. Confirm the record says filing notes is not yet available, rather than simply having no button.
118. Repeat 112 in German and confirm dates and headings are translated.

## Phase 6 — filing notes on a patient

Needs two accounts: a clinical one (nurse or doctor) and a **read-only** one (carer). Step 123 is the
one that cannot be checked any other way.

119. As a nurse, open a patient and file an entry. It appears at the top of the activity list
     **marked as unsent**, with a coloured left border — not merged in looking like a filed note.
120. Wait for it to send: the chip and the border disappear and the entry appears in the list
     proper, from the server.
121. **File an entry with airplane mode on.** It is accepted, marked unsent, and the dialog says it
     will be sent when there is signal. Restore signal and watch it clear.
122. **File offline, force-quit, relaunch, restore signal.** The entry sends once — not twice. This
     is the `clientRef` path and the failure it prevents is invisible until someone reads the
     record back.
123. **Sign in as a carer and open a patient.** There is no _Add an entry_ button; the record says
     the role cannot file notes. Confirm the record itself still reads normally — read-only is not
     no-access.
124. As a nurse again, file an entry and immediately open a different patient: the unsent entry must
     NOT appear on the second patient's record.
125. Repeat 119 in German and confirm the queued-note wording is translated.

## MOB11+ — added as each work package lands

_(Each MOB adds its steps here as part of its gate.)_
