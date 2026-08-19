# Dependency audit — triage

MOB1 recorded 34 advisories and deferred triage to MOB12 rather than fighting the dependency tree
mid-bootstrap. This is that triage, run on 2026-08-19.

`npm audit` now reports **36**: 2 low, 10 moderate, 23 high, 1 critical.

The count is not the finding. **All 36 collapse to a single decision**, and it is not one that can be
taken inside this work package.

## Everything is fixed by the same upgrade, and it is three majors away

| | |
| --- | --- |
| Installed | Angular **19.2.25** |
| `v19-lts` dist-tag | **19.2.25** — the same version |
| `fixAvailable` for every runtime advisory | `@angular/core` **22.1.2**, `isSemVerMajor: true` |
| `fixAvailable` for the one critical | `@angular/cli` **22.1.4**, same upgrade |

**Angular 19 is at its terminal LTS release.** 19.2.25 is both what is installed and the last version
the 19 line will receive, so these advisories will not be patched in place — there is no 19.2.26 to
wait for. The remedy is Angular 22, which is a three-major migration and touches `web/` as well,
since both share the toolchain.

That is a real decision with real scope, and it does not belong in a commit whose subject is release
engineering. Recorded here so it is a scheduled piece of work rather than a recurring surprise in a
CI log.

## What is actually exposed

Of the 36, **7 are reachable from a runtime dependency** — all of them Angular packages, via five
advisories. The other 29 are build- and dev-toolchain only, including the single critical
(`node-tar`, decompression DoS), which runs on a build machine and ships in nothing.

Of those five runtime advisories, four do not apply to how this app is built:

| Advisory | Applies here? |
| --- | --- |
| Client Hydration DOM Clobbering & Response-Cache Poisoning | **No** — hydration is an SSR feature; this is a Capacitor SPA with no server render |
| `HttpTransferCache` weak 32-bit cache key | **No** — `HttpTransferCache` is SSR-only |
| `HttpTransferCache` cache-key ambiguity | **No** — same |
| i18n XSS via event-handler attributes | **No** — this is Angular's own `$localize` i18n; the app uses `@ngx-translate/core`, and the catalogues are compiled TypeScript |
| `formatDate` DoS via OOM | **Possibly** — the app formats dates, though the DoS needs an attacker-controlled format string, and formats here are internal |

So the practical runtime exposure today is one low-likelihood DoS. **The strategic exposure is that
the framework line is terminal**, which is the part worth scheduling against.

## How to re-run this

```bash
npm audit --json > audit.json
```

Then separate runtime from build-only by asking whether each advisory's package is a production
dependency or is reached through one — the count alone tells you nothing, because a critical in a
build tool and a moderate in a shipped library are not comparable.

**Do not read `npm view @angular/core versions` and compare strings.** Version strings sort
lexicographically, so `19.2.3 > 19.2.25` is "true" and it is easy to conclude a fix exists when it
does not. Use the `fixAvailable` field in the audit output, which resolves it properly — that is what
turned "bump the patch" into "there is no patch" here.
