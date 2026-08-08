// The sitemap, split into a sitemap index + per-section segments.
//
// Why not the Next `app/sitemap.ts` metadata convention any more: it emits one
// flat file. At ~10k URLs that is legal (the limits are 50k URLs / 50MB) but it
// is undiagnosable - Search Console reports "Discovered / Indexed" per SUBMITTED
// SITEMAP, so a single file can only ever tell you "some of your 10,000 pages
// are missing". Segmenting by section turns that into "areas-2 is at 40%", which
// is the difference between knowing and guessing. Next's own `generateSitemaps()`
// splits, but only into /sitemap/0.xml, /sitemap/1.xml … with no index file, and
// robots.txt has to point somewhere - so the index and the segments are both
// written by hand here (app/sitemap.xml + app/sitemaps/[segment]).
//
// Built once per deploy, exactly like the file it replaces. Clean (locale-less)
// URLs are the canonical ones - middleware picks the reader's language, so one
// URL serves every locale.
import {
  getAllElectionSeats,
  getAllPersonIds,
  getDistrictsInState,
  getIndex,
  getPerson,
  getStates,
  isThinProfile,
} from '@/lib/data';
import { canonicalDistrictForConstituency } from '@/lib/locality';
import { GUIDE_SLUGS } from '@/lib/guides';
import { auditGovernments, auditsForGovernment, govSlug } from '@/lib/audits';
import { profileLastUpdated } from '@/lib/format';
import { SITE_URL } from '@/lib/site-url';

export type SitemapUrl = {
  loc: string;
  /** W3C date (yyyy-mm-dd). Omitted wherever we have no real content date. */
  lastmod?: string;
  changefreq: 'daily' | 'weekly';
};

export type SitemapSegment = { id: string; urls: SitemapUrl[] };

/** Segment size. Well under the 50k ceiling on purpose: smaller files give
 *  finer-grained coverage reporting, which is the whole point of splitting. */
const SEGMENT_SIZE = 2500;

/** Later of two ISO dates - they sort lexicographically, so no Date parsing. */
const newer = (a: string | undefined, b: string | undefined): string | undefined =>
  !a ? b : !b ? a : a > b ? a : b;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Split a list into segments named `${base}-1`, `${base}-2`, … (or just
 *  `${base}` when it fits in one file, so small sections keep a stable name). */
function segmented(base: string, urls: SitemapUrl[]): SitemapSegment[] {
  const parts = chunk(urls, SEGMENT_SIZE);
  if (parts.length <= 1) return urls.length ? [{ id: base, urls }] : [];
  return parts.map((part, i) => ({ id: `${base}-${i + 1}`, urls: part }));
}

async function build(): Promise<SitemapSegment[]> {
  const [idx, states, personIds, electionSeats] = await Promise.all([
    getIndex(),
    getStates(),
    getAllPersonIds(),
    getAllElectionSeats(),
  ]);

  // `lastmod` is the one sitemap field Google actually consumes, and it only
  // keeps consuming it while it stays accurate - an inaccurate lastmod gets the
  // signal ignored site-wide. So every date below is a real retrieval date from
  // the cited data, and anything we cannot date honestly (the prose pages, which
  // change only on deploy) simply carries no lastmod at all. Missing beats wrong.
  const personDate = new Map<string, string>();
  const areaDate = new Map<string, string>();
  const districtDate = new Map<string, string>();
  const stateDate = new Map<string, string>();
  let datasetDate: string | undefined;

  for (const p of idx.politicians) {
    const d = profileLastUpdated(p);
    if (!d) continue;
    personDate.set(p.id, d);
    datasetDate = newer(datasetDate, d);
    if (p.constituencyId) areaDate.set(p.constituencyId, newer(areaDate.get(p.constituencyId), d)!);
    if (p.stateCode) {
      stateDate.set(p.stateCode, newer(stateDate.get(p.stateCode), d)!);
      for (const dist of p.districts) {
        if (!dist?.trim()) continue;
        const key = `${p.stateCode}/${dist}`;
        districtDate.set(key, newer(districtDate.get(key), d)!);
      }
    }
  }

  const cagDate = auditGovernments().reduce<string | undefined>(
    (acc, gov) => auditsForGovernment(gov).reduce<string | undefined>((a, r) => newer(a, r.retrieved_date), acc),
    undefined,
  );
  const electionDate = electionSeats.reduce<string | undefined>((a, { event }) => newer(a, event.retrieved_date), undefined);

  // ---- core: the hubs and the prose ----------------------------------------
  // Declared cadence: hub pages daily (they carry revalidate=86400), the rest
  // weekly. NB Google documents that it ignores <changefreq>; the honest values
  // are for other crawlers, and the actual ISR-write savings come from the
  // revalidate windows and robots.ts, not from this file.
  const core: SitemapUrl[] = [
    { loc: `${SITE_URL}/`, changefreq: 'daily', lastmod: datasetDate },
    ...['/india', '/hierarchy', '/rankings'].map((p) => ({
      loc: `${SITE_URL}${p}`,
      changefreq: 'daily' as const,
      lastmod: datasetDate,
    })),
    { loc: `${SITE_URL}/elections`, changefreq: 'daily', lastmod: electionDate },
    { loc: `${SITE_URL}/audits`, changefreq: 'weekly', lastmod: cagDate },
    ...['/rights', '/why-care', '/for-leaders', '/who', '/accountability', '/about', '/methodology', '/grievance', '/privacy', '/terms', '/guides'].map(
      (p) => ({ loc: `${SITE_URL}${p}`, changefreq: 'weekly' as const }),
    ),
    ...GUIDE_SLUGS.map((slug) => ({ loc: `${SITE_URL}/guides/${slug}`, changefreq: 'weekly' as const })),
  ];

  // ---- geography -----------------------------------------------------------
  const stateUrls: SitemapUrl[] = [];
  const districtUrls: SitemapUrl[] = [];
  for (const s of states) {
    stateUrls.push({ loc: `${SITE_URL}/state/${s.stateCode}`, changefreq: 'weekly', lastmod: stateDate.get(s.stateCode) });
    for (const d of await getDistrictsInState(s.stateCode)) {
      districtUrls.push({
        loc: `${SITE_URL}/district/${s.stateCode}/${encodeURIComponent(d)}`,
        changefreq: 'weekly',
        lastmod: districtDate.get(`${s.stateCode}/${d}`),
      });
    }
  }

  const areaUrls: SitemapUrl[] = [];
  for (const c of idx.constituencies) {
    // The district is canonical where it is the exact same locality as a
    // single-district Assembly seat; list one URL, never both.
    if (canonicalDistrictForConstituency(c)) continue;
    areaUrls.push({ loc: `${SITE_URL}/area/${c.id}`, changefreq: 'weekly', lastmod: areaDate.get(c.id) });
  }

  // ---- people --------------------------------------------------------------
  // Un-enriched stubs are served with `robots: noindex` (see isThinProfile and
  // the person page's generateMetadata). Submitting a noindex URL in a sitemap
  // asks Google to spend crawl budget on a page we have already told it not to
  // index, and it comes back as an "Excluded by noindex tag" pile in Search
  // Console that buries the real coverage problems. So the sitemap lists only
  // what we actually want indexed.
  const peopleUrls: SitemapUrl[] = [];
  for (const id of personIds) {
    const res = await getPerson(id);
    // No person = an alias id that only redirects; its target is listed already.
    if (!res?.person || isThinProfile(res.person)) continue;
    peopleUrls.push({ loc: `${SITE_URL}/person/${id}`, changefreq: 'weekly', lastmod: personDate.get(id) });
  }

  // ---- audits: one page per audited government -----------------------------
  // These were missing entirely: app/sitemap.ts imported auditGovernments and
  // govSlug and then never looped over them, so all 32 /audits/{gov} pages were
  // published, prerendered, internally linked - and never submitted.
  const auditUrls: SitemapUrl[] = auditGovernments().map((gov) => ({
    loc: `${SITE_URL}/audits/${govSlug(gov)}`,
    changefreq: 'weekly',
    lastmod: auditsForGovernment(gov).reduce<string | undefined>((a, r) => newer(a, r.retrieved_date), undefined),
  }));

  // ---- elections -----------------------------------------------------------
  // Daily while an election is live is tempting, but the pages themselves do not
  // change - only the count does, and that is fetched by the browser, not baked in.
  const electionUrls: SitemapUrl[] = [];
  for (const { seat, event } of electionSeats) {
    electionUrls.push({ loc: `${SITE_URL}/elections/${seat.slug}`, changefreq: 'weekly', lastmod: event.retrieved_date });
    for (const c of seat.candidates) {
      // A candidate linked to a sitting member redirects to their profile,
      // which is already in the sitemap - listing both would be a duplicate.
      if (c.politicianId) continue;
      electionUrls.push({
        loc: `${SITE_URL}/elections/${seat.slug}/${c.slug}`,
        changefreq: 'weekly',
        lastmod: event.retrieved_date,
      });
    }
  }

  return [
    ...segmented('core', core),
    ...segmented('states', stateUrls),
    ...segmented('districts', districtUrls),
    ...segmented('areas', areaUrls),
    ...segmented('people', peopleUrls),
    ...segmented('audits', auditUrls),
    ...segmented('elections', electionUrls),
  ];
}

// One build per process. Both routes (the index and every segment) ask for the
// whole set, and at build time that is ~10 prerenders of the same computation.
let cached: Promise<SitemapSegment[]> | null = null;
export function sitemapSegments(): Promise<SitemapSegment[]> {
  if (!cached) cached = build();
  return cached;
}

export const segmentPath = (id: string): string => `${SITE_URL}/sitemaps/${id}.xml`;

/** A segment's own lastmod: the most recent one it contains. */
export const segmentLastmod = (seg: SitemapSegment): string | undefined =>
  seg.urls.reduce<string | undefined>((a, u) => newer(a, u.lastmod), undefined);

// Every value below is either a slug or an encodeURIComponent'd path, so `&`
// and `<` should never appear - escaping anyway is one line and the alternative
// is an unparseable sitemap discovered via Search Console weeks later.
const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function urlsetXml(urls: SitemapUrl[]): string {
  const body = urls
    .map(
      (u) =>
        `<url><loc>${xmlEscape(u.loc)}</loc>` +
        (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
        `<changefreq>${u.changefreq}</changefreq></url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function sitemapIndexXml(segments: SitemapSegment[]): string {
  const body = segments
    .map((s) => {
      const lastmod = segmentLastmod(s);
      return `<sitemap><loc>${xmlEscape(segmentPath(s.id))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}
