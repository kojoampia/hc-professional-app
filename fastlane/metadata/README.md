# Store listings, in four languages (MOB13)

Listing copy for Google Play and the App Store, in **en / es / fr / de** — the same four languages
the app itself ships. That is not a nicety: an app that advertises itself in English and then opens
in German is an Apple rejection risk, and `mobile-app-plan.md` makes four languages a shipping
condition for every package, store-facing copy included.

There is no `Fastfile` in this repository. `release-ios.yml` calls `fastlane match`, `gym` and
`pilot` directly, and `release-android.yml` uses the `upload-google-play` action. This directory
follows fastlane's `supply`/`deliver` layout anyway, so the standard tools can consume it unchanged
if a `Fastfile` ever lands.

## What is published automatically, and what is not

| | Published on a `v*` tag | By what |
| --- | --- | --- |
| Android **release notes** | **yes** | `release-android.yml` → `whatsNewDirectory` |
| Android title / short / full description | no | `fastlane supply`, or paste once |
| iOS everything | no | `fastlane deliver`, or paste once |

**Release notes are the only thing a tag republishes, deliberately.** A listing changes rarely and
is reviewed by a human at the store; republishing it on every build is how a reviewed listing gets
silently reverted to whatever was in the repo at tag time. Descriptions are applied once, on
purpose, by someone who then reads the result.

The `whatsnew/` directory duplicates each locale's `changelogs/default.txt` because the two tools
disagree about layout: the action wants `whatsnew/whatsnew-<locale>` flat, `supply` wants
`<locale>/changelogs/<versionCode>.txt`. **They must be edited together** — the flat copy is what
actually ships today.

## Store limits, and how they are enforced

Every file here is within the limit for its field. The tight ones, all counted in characters:

| Field | Limit | Note |
| --- | --- | --- |
| Play title | 30 | `Abofonsa BridgeCare Pro` = 23 |
| Play short description | 80 | the binding one — en is 77 |
| App Store name | 30 | same string as the Play title |
| App Store subtitle | 30 | **the binding one.** "Roster and records for clinicians" was written first and is 33; it had to be cut |
| App Store keywords | 100 | comma-separated, no spaces after commas — a space costs a character |

There is no linter for this. Re-count after any edit; the stores reject on submission, which is the
slowest possible moment to find out.

## The brand name is never translated

"Abofonsa BridgeCare" is the same string in all four listings, per `CLAUDE.md § The brand name`.
Where a field is too tight for the full name, the correct shortening is **"Abofonsa"**, never
"BridgeCare" alone.

## What the copy deliberately says

The description opens by stating this is **a work tool for verified professionals, not a consumer
health app**, and closes by telling patients and family members that this is not the app they want.
That is aimed squarely at Apple's health-app scrutiny (1.4.1 / 5.1.1(ix)) and at the reviewer who
will otherwise install it, find a login wall, and reject it. It pairs with the two things
`mobile-app-plan.md` calls out as the top rejection causes: a **reviewer demo account** seeded with
a roster and a message thread, and an institutional affiliation letter from Abofonsa.

The data paragraph is written to match what the app actually does — roster-scoped patient data,
nothing cached unencrypted, wiped on sign-out, no sale of data, no advertising — because it has to
agree with the Play Data Safety form and the App Store privacy nutrition labels, which are filled in
separately in each console. **If the app's behaviour changes, this paragraph and both forms change
together.**

## Still outstanding for MOB13

These need store access or a Mac and are not in this repository:

- **Screenshots**, per platform, per device size, in four languages.
- **Play Data Safety** and **App Store privacy nutrition** declarations.
- **The Play closed test** — ≥14 days with ≥12 opt-in testers for personal accounts created after
  Nov 2023; org accounts are generally exempt, and which applies has never been confirmed. This is
  the largest schedule risk in the plan and it was meant to start at MOB8.
- **The reviewer demo account**, seeded.
- **`InfoPlist.strings` target membership** — the `.lproj` files exist and the languages are now
  declared in `Info.plist`, but the strings are still not members of the App target, so iOS keeps
  showing the English prompts. See `ios/App/App/README-localisation.md`; it needs Xcode.
