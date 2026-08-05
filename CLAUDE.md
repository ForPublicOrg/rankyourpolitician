# Working rules for this repo

RankYourPolitician is a free, open-source, non-partisan civic platform for India. It is built
**for the public**: no logins, no paywalls, no dark patterns, and it must stay fast on cheap
phones and slow networks. Every contribution - human or AI-assisted - is judged against the
three rules below before anything else.

## 1. Never trade away speed or user experience

The whole architecture exists so every page is a CDN cache hit, not a serverless cold start.
Read "How data flows" in README.md before touching `lib/data.ts` or any page.

- **Every page stays static/ISR.** Never call `cookies()`, `headers()` or read `searchParams`
  in a page render path - any of these makes the route dynamic. Locale comes from the `[lang]`
  URL segment (rewritten by `middleware.ts`), never from a cookie read during render.
- **No new per-request Firestore reads.** Runtime reads go through the TTL-memoised loaders in
  `lib/data.ts` (aggregates 5 min, government data 30 min). A new hot-path read multiplies the
  free-tier bill by crawler traffic.
- **Live numbers are client-fetched, never baked into pages.** Votes and trending follow the
  same pattern: an API route served from the in-process cache, CDN-cached with `s-maxage`
  (see `app/api/vote`, `app/api/trending`). Copy that pattern for anything that must be fresh.
- **Keep payloads small.** Large lists are precomputed into `public/*.json` at build
  (`prebuild`) and fetched lazily; pages embed only small slices. The home page once shipped
  all ~5,400 leaders in its RSC payload - multi-MB pages, seconds per navigation. Never again.
- **No blocking third-party scripts.** Anything loaded client-side must be `afterInteractive`
  or lazier, and must degrade gracefully when blocked (see Turnstile handling in VoteWidget).

## 2. No personal data collection

The site knows nothing about its visitors, and that is a feature (and a DPDP Act 2023
obligation - see the legal checklist in README.md).

- **Never store raw IPs, fingerprints, emails, names, or any visitor identifier.** Vote dedupe
  uses a salted SHA-256 of a coarsened IP + coarse device signal (`lib/vote-integrity.ts`) and
  it stays that way. Do not log request IPs either.
- **No accounts, no sessions, no login walls.** Features must work for an anonymous visitor.
- **No new trackers or analytics.** The single Vercel Analytics mount on the home page is the
  ceiling, not the floor. PRs adding ad-tech, session replay, or any third-party beacon that
  profiles users will be declined.
- Personal data ABOUT politicians is different: it is public-record data (affidavits, official
  rosters) and every datapoint must carry an official citation.

## 3. Everything is for the public

- MIT-licensed code; the full dataset ships in `data/seed/` so the site runs with zero setup.
- **No citation, no claim.** Every displayed fact carries a source URL + retrieved date;
  `npm run dm -- validate` fails otherwise. Missing beats wrong - never guess or backfill data
  from memory.
- **Neutrality is the bar.** Information, never verdicts: no guilt inferences, no party
  colours, ranking shown as "top N% within a comparable cohort", sentiment displayed as the
  plain mean of votes actually cast (the Bayesian score orders, it is never printed).
- The India map is legally constrained: never swap in GADM/Natural Earth/OSM boundaries
  (README legal checklist).

## 4. Elections have rules of their own

The `/elections` section publishes candidates and counts during a live election, which puts
it under election law as well as the three rules above.

- **Never invent a vote count.** Live numbers come from ECI's own results pages via
  `/api/election-live`, are labelled as ECI's, and carry ECI's own "not final until Form 20"
  caveat. A count we cannot read is shown as unavailable with a link to the Commission -
  never as a zero, never interpolated, never projected.
- **Rating a candidate is an opinion survey**, so it closes 48 hours before the poll closes
  and reopens 30 minutes after (RP Act 1951 s.126(1)(b) and s.126A). The window is computed
  from the cited schedule in `lib/elections.ts`, enforced in `app/api/vote`, and mirrored in
  `VoteWidget` - during it the form *and* the tally disappear. Do not add any other
  opinion-shaped UI to a candidate without the same gate.
- **One human, one ratable page.** A candidate with a `politicianId` redirects to
  `/person/{id}` and is not separately ratable. Two ratable pages for one person let a single
  visitor rate them twice - this repo has shipped that bug before. `dm validate` enforces it.
- **Show every nomination, not just the winners** - contesting, withdrawn and rejected -
  in the Commission's own order. Ordering candidates ourselves would read as a ranking.
- ECI lists nomination *papers*, not people (one candidate may file up to four). Fold papers
  into people before storing, or every count on the page is wrong.

## Commands

```bash
npm run dev          # local dev - serves the committed seed with no credentials
npm run typecheck    # required before every PR
npm run build        # prebuild regenerates public/*.json payloads (hash-gated: skips when data/tools/lib unchanged), then next build
npm run dm -- validate            # data changes must pass this
npm run dm -- backfill-trending   # trending bucket rebuild (dry run; --apply writes)

# After `dm update-all`: the affidavit steps join on name within a state, so two
# same-named members can end up citing one MyNeta page - i.e. one of them is
# publishing the other's declared assets and criminal cases. validate blocks on
# it; this resolves each from the cited page's own breadcrumb seat + district.
npx tsx tools/data-manager/resolve-affidavit-collisions.ts --apply

# Elections. Add the event to tools/data-manager/elections-shared.ts, then:
npx tsx tools/data-manager/import-elections.ts --apply        # every nomination, from ECI
npx tsx tools/data-manager/enrich-candidates.ts --apply       # affidavit detail, from MyNeta
npx tsx tools/data-manager/fetch-election-results.ts --apply  # freeze the count once counting ends
npx tsx tools/data-manager/link-candidates.ts --apply         # link a winner to their new profile
```

## Gotchas that have bitten before

- `.env.local` with Firebase creds means `npm run dev` **writes votes to production data**.
  Never cast test votes locally against prod creds; use the credential-less seed mode.
- `NEXT_PUBLIC_*` env vars are inlined at **build time** - adding one in Vercel does nothing
  until the next deploy actually rebuilds.
- `REVALIDATE_URL` must use the canonical `www` host: a host redirect drops the Authorization
  header and the revalidation ping silently 401s.
- Firestore is never read during `next build` (`getDb()` returns null in the build phase);
  pages prerender from the seed.
