import { NextRequest, NextResponse } from 'next/server';
import { getAllRatings, getTopRated } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE = { 'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' };

/** Live ratings, two shapes behind one route (both from the in-process
 *  TTL-cached aggregates - zero extra Firestore reads - and CDN-cached for
 *  5 minutes, so most page views never invoke the function):
 *
 *  - GET /api/ratings       → every rated leader as compact rows of
 *    [bayesian_mean, raw_mean, n_votes] keyed by person id. RankingList merges
 *    these into server/static ranking entries so the "sort by rating" view
 *    reflects real votes (baked payloads only carry a compute-time snapshot).
 *  - GET /api/ratings?top=N → the N highest-rated leaders enriched with
 *    name/party/photo for the home "Top rated" tab. Mirrors /api/trending. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const topRaw = sp.get('top');
  if (topRaw != null) {
    const n = Number(topRaw);
    const limit = Number.isFinite(n) ? Math.min(12, Math.max(1, Math.floor(n))) : 5;
    // Optional ?state= / &district= scope, exactly as /api/trending: the
    // state and district pages mount the same card. Unknown values match
    // nothing and return a cacheable empty list.
    const state = sp.get('state');
    const district = sp.get('district');
    const scope = state ? { stateCode: state, district: district || undefined } : undefined;
    const entries = await getTopRated(limit, scope);
    return NextResponse.json({ ok: true, entries }, { headers: CACHE });
  }

  const ratings = await getAllRatings();
  return NextResponse.json({ ok: true, ratings }, { headers: CACHE });
}
