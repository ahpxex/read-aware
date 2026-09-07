# Search and attribution operations

## Public pages

`bun run build` prerenders every concrete route, including localized titles,
descriptions, canonicals, real language alternates, JSON-LD, and sitemap entries.
`bun run test:static` checks these contracts, platform downloads, screenshots,
source classification, the anonymous event endpoint, and IndexNow diffs.

Add substantive pages, not keyword-swapped variants. Topic routes and their
footer links live in `src/routes/` and `src/lib/topic-pages.ts`. Only actual
translations belong in `availableLocales`. Unknown production URLs return 404;
the standalone `/sync/login/` document remains separate and has no analytics.

Facts must match the shipping app and relay: AGPL-3.0, local offline reading,
50 MB free encrypted sync, paid storage expansion, optional remote AI (BYOK
provider fees or Pro/Max bundled usage), signed/notarized macOS, unsigned Windows,
signed ARM64 Android APK. Local storage and sync encryption do not make remote
AI inference private from the selected model provider.

## Download attribution

`src/lib/site-analytics.ts` runs only on `https://readaware.app`, respects DNT/GPC,
and excludes secret-bearing URLs. Existing cookie-free Cloudflare Web Analytics
remains for aggregate traffic/performance. The first-party `/api/site-events`
endpoint records landing entries and direct release-asset clicks, not installs,
completed downloads, accounts, or unique people. It never delays the GitHub link.

Source is a whitelist category derived from `utm_source` or the referrer host.
No raw URL parameters, fragments, email, IP, visitor ID or reading data are written
to Analytics Engine. Session storage retains only the category, public landing
path and expiry; attribution is reused for 30 minutes across internal/language
navigation. A preserved UTM on the automatic locale redirect does not double count.
Blocked scripts, missing referrers, new tabs and automated traffic affect counts;
do not interpret these aggregates as precise conversion rates or proven citations.

Wrangler binds `SITE_ANALYTICS` to `readaware_site_events`. Cloudflare creates the
dataset on its first production write. No manual dataset provisioning is needed.
Do not add request/body logging or persistent identifiers to this endpoint.
Keep the localized privacy policy in sync with any measurement changes.

Dataset v1 has one sampling index (`source`) and this fixed field order:

| Field | Meaning |
| --- | --- |
| blob1 | schema version `v1` |
| blob2 | `landing` or `download` |
| blob3 | coarse source category |
| blob4 | public landing path |
| blob5 | current public path |
| blob6 | downloaded platform, empty on landing |
| blob7 | official stable asset alias, empty on landing |
| blob8 | release tag displayed by the page, not the resolved installer version |
| double1 | event count, always 1 |

Use `SUM(_sample_interval * double1)`, not `COUNT(*)`, because Analytics Engine
can sample. `bun scripts/download-report.ts 30` prints the last 30 days grouped
by source, landing path, click path and asset. It requires `CLOUDFLARE_ACCOUNT_ID`
and `CLOUDFLARE_ANALYTICS_TOKEN` (Account Analytics Read). Keep the token outside
git, in the shell/secret store. The SQL is also usable in Cloudflare Query Builder.
The stable GitHub alias can resolve to a newer release than an old cached page
advertised. Use `advertised_release` for page cohorts, not proof of installed version.

## IndexNow

The build writes `search-manifest.json`: public canonical URLs plus hashes of
visible main content, titles/descriptions, language alternates, links and images.
Bundle/CSS hashes and build timestamps do not cause submissions. The root TXT
verification file is deliberately public; it is not an account credential.

The landing workflow restores the last acknowledged manifest, snapshots the live
site, deploys, verifies the production manifest/key, and submits added/changed/
removed URLs to IndexNow. It checkpoints only after HTTP 200 or 202. A failed
notification is retried on the next deployment even if content is unchanged.
If the checkpoint cache is absent, current URLs are resubmitted conservatively.
The pre-deploy snapshot is also retained as a workflow artifact for 30 days.

For manual deployment, preserve the same ordering:

```sh
bun run build
bun run test:static
bun scripts/indexnow.mjs snapshot /tmp/readaware-before.json /tmp/readaware-ack.json
bunx wrangler deploy
bun scripts/indexnow.mjs submit /tmp/readaware-before.json /tmp/readaware-ack.json
```

Never notify unpublished pages. HTTP 200 means receipt, 202 means key validation
pending; neither proves indexing. IndexNow does not replace Google Search Console.
After deployment, inspect/request indexing for the few materially changed entry
pages in Search Console, and recheck the existing sitemap in Google and Bing.
Do not spam all routes or add invented `lastmod` dates on every build.

## Dashboard audit, 2026-09-07

- Cloudflare AI policies: Search, Agent and Training all allowed. Per-crawler
  blocking was off, including Googlebot, BingBot, OAI-SearchBot and ChatGPT-User.
- No custom WAF rules or rate-limit rules on the zone. Bot Fight Mode and AI
  Labyrinth were off; browser integrity and built-in DDoS protection were retained.
  No broad security bypass was needed or applied.
- Bing's short-title and short-description reports both named `/zh/pricing`
  and `/zh/docs/plugins/`. Their copy was expanded with actual offer/capability
  information, not padded to an English character-count target.
- Bing's sitemap was successful with 115 known URLs. The revised build has 117;
  that is a local build result until the landing deployment completes.
- The IndexNow setup recommendation is addressed by the workflow above, not by
  repeatedly submitting the sitemap. Its production status needs post-deploy
  verification; a locally passing endpoint is not a live dataset write.

References: [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/get-started/),
[IndexNow protocol](https://www.indexnow.org/documentation),
[Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features).

## Local acceptance

The revised build passed typechecking and 28 tests (2,015 assertions), including
all 117 pages. All eight homepages were checked at 320 x 740: no horizontal
overflow, loaded screenshots visible in the first viewport, and no local
telemetry. Chinese platform pages were checked on desktop and mobile, including
the Android dark screenshot and platform-specific downloads under a macOS UA.
Local Wrangler returned 200 for pages/login, 308 for canonical redirects, 404
for missing pages, 204 for valid events and 403 for cross-origin events. Wrangler
deployment dry-run resolved both bindings. These checks do not establish a live
Analytics Engine write or a successful production IndexNow notification.
