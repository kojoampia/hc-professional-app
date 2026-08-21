# iOS permission prompts — half done, and the half that is missing is invisible

`es.lproj/`, `fr.lproj/` and `de.lproj/` contain `InfoPlist.strings` with the camera, photo
library and Face ID prompts translated. **They do nothing yet.** A `.lproj` file that is not a
member of the app target is not copied into the bundle, so iOS never sees it and shows the
English strings from `Info.plist` — on every device, in every language, with nothing logged and
nothing failing to build.

That is why this file exists: the work looks finished in a diff and is not.

## What is left (needs Xcode on a Mac)

**One step, not two, as of MOB13.** Step 2 is done; step 1 is not, and it is the one that matters.

1. **Add the three files to the `App` target.** In Xcode, drag each `InfoPlist.strings` into the
   project navigator with *Copy items if needed* **off** and *Add to targets: App* **on**. Xcode
   should collapse them into one `InfoPlist.strings` entry with three children; if it does not,
   select the file, open the File inspector, and tick `es`, `fr`, `de` under *Localization*.
2. ~~**Declare the languages** in `Info.plist`~~ — **done in MOB13.** `CFBundleLocalizations` now
   lists `en`, `es`, `fr`, `de`, so the App Store lists the app as localised rather than
   English-only.

   **This did not fix the prompts, and could not.** Declaring a language and bundling its strings
   are separate things: step 1 above is still what copies the `.strings` files into the app, and
   until it is done a German device still reads the English `Info.plist` entries. If anything the
   declaration makes the gap worse — the store now advertises German while the permission dialogs
   speak English.

## How to verify — not by reading the code

Set the **device** (not the app) to German, delete the app, reinstall, and trigger the camera
prompt from Documents. The dialog must read *"Abofonsa BridgeCare verwendet die Kamera…"*. If it
reads English, step 1 did not take — which is the failure this file is warning about, and it
cannot be seen any other way.

A faster check on a built `.app`: `plutil -p App.app/de.lproj/InfoPlist.strings`. If the path does
not exist, the file was never bundled.

## Why the English originals stay in `Info.plist`

They are the fallback for any locale not shipped here, and Apple requires a usage description in
`Info.plist` itself — an entry present only in a `.strings` file is treated as missing, and the app
is rejected at review.

## Related

- `docs/mobile-app-plan.md` § MOB13 — the store-submission gate that owns this.
- `CLAUDE.md` § The brand name — why "Abofonsa BridgeCare" is not translated in any of the three.
