import { NextResponse } from 'next/server';
import { isFirestoreConfigured } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight liveness endpoint. Must cost ZERO Firestore reads: uptime
// monitors ping it every minute, and it previously loaded the whole dataset
// (a full vote_aggregates scan per ping). Config check only.
export async function GET() {
  const source = isFirestoreConfigured() ? 'firestore' : 'seed';
  return NextResponse.json({ ok: true, source, ts: new Date().toISOString() });
}
