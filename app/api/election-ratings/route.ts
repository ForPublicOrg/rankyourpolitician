import { NextRequest, NextResponse } from 'next/server';
import { getElectionCandidateRatings } from '@/lib/data';
import { TRENDING_WINDOW_DAYS } from '@/lib/trending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This is a seat-scoped companion to /api/trending and /api/ratings. It reads
// the same in-process aggregate index, then the CDN keeps the compact payload
// warm for two minutes. The seat page fetches it only after this card is seen.
const CACHE = { 'cache-control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=300' };

export async function GET(req: NextRequest) {
  const seat = req.nextUrl.searchParams.get('seat');
  if (!seat) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const mode = req.nextUrl.searchParams.get('mode') === 'top' ? 'top' : 'trending';
  const raw = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(raw) ? Math.min(8, Math.max(1, Math.floor(raw))) : 5;
  const entries = await getElectionCandidateRatings(seat, mode, limit);

  return NextResponse.json(
    { ok: true, mode, ...(mode === 'trending' ? { windowDays: TRENDING_WINDOW_DAYS } : {}), entries },
    { headers: CACHE },
  );
}
