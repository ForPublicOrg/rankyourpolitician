'use client';
// The one live thing on an election seat page.
//
// The page itself is static ISR like every other page on this site, so the HTML
// can be a week old. That is fine for names and dates; it is not fine for a
// count that moves every few minutes. So the count is fetched by the browser
// from /api/election-live, exactly the split VoteWidget and the trending list
// use - the page stays a CDN hit and the numbers are never stale.
//
// Three behaviours worth knowing:
//   - It re-polls only while counting is actually running AND the tab is
//     visible. A backgrounded tab stops asking; there is no point warming a
//     serverless function for a page nobody is looking at.
//   - A failed read never blanks a good one. We keep showing the last count we
//     had, and say when it was taken.
//   - It never renders an absent number as zero. No count means we say there is
//     no count and point at the Election Commission.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { observe } from '@/components/motion';
import Icon from '@/components/Icon';
import { CountCaveat, CountRow } from '@/components/ElectionBits';
import type { ElectionResultRow, LiveCountSeat } from '@/lib/types';

const POLL_MS = 60_000;

type Payload = {
  status: 'live' | 'stale' | 'unavailable' | 'not-counting' | 'final' | 'unknown';
  fetchedAt?: string;
  seats?: LiveCountSeat[];
};

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; payload: Payload };

function Skeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <ul className="space-y-2" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="h-[76px] animate-pulse rounded-2xl border border-line bg-paper-sink" />
      ))}
    </ul>
  );
}

export default function LiveCount({
  eventId,
  seatSlug,
  expectedRows,
  officialUrl,
  countingDate,
}: {
  eventId: string;
  seatSlug: string;
  /** How many rows to size the skeleton to, so nothing jumps when it resolves. */
  expectedRows: number;
  officialUrl?: string;
  countingDate: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  // Kept outside state so a failed poll can fall back to it without a re-render
  // race - "stale beats blank" is the same rule RankingList follows.
  const lastGood = useRef<Payload | null>(null);

  const load = useCallback(() => {
    started.current = true;
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    // Counts are intentionally live. `cache: 'no-store'` prevents a browser
    // cache from replaying an earlier `seats: []` response after ECI has
    // started publishing the table; the route still controls its short CDN
    // cache for upstream load protection.
    return fetch(`/api/election-live?event=${encodeURIComponent(eventId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Payload & { ok?: boolean }) => {
        if (data?.seats?.length) lastGood.current = data;
        setState({ kind: 'ready', payload: data });
        return data;
      })
      .catch(() => {
        setState(lastGood.current ? { kind: 'ready', payload: { ...lastGood.current, status: 'stale' } } : { kind: 'error' });
        return null;
      });
  }, [eventId]);

  // Fetch when the card first scrolls into view, on the shared observer. The
  // ref (not state) is what guards React StrictMode's dev double-invoke.
  useEffect(() => {
    if (started.current) return;
    const el = rootRef.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < window.innerHeight) {
      void load();
      return;
    }
    return observe(el, () => {
      if (!started.current) void load();
    });
  }, [load]);

  // Re-poll only while there is something to re-poll for, and only while
  // somebody is looking.
  const status = state.kind === 'ready' ? state.payload.status : null;
  const shouldPoll = status === 'live' || status === 'stale' || status === 'unavailable';
  useEffect(() => {
    if (!shouldPoll) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (!document.hidden) void load();
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [shouldPoll, load]);

  const seat = state.kind === 'ready' ? state.payload.seats?.find((s) => s.seatSlug === seatSlug) : undefined;

  return (
    <div ref={rootRef}>
      {(state.kind === 'idle' || state.kind === 'loading') && (
        <Skeleton rows={Math.min(6, Math.max(2, expectedRows))} label={t('elections.countLoading')} />
      )}

      {state.kind === 'error' && (
        <Notice tone="warn" icon="warn">
          {t('elections.countError')}{' '}
          <button type="button" onClick={() => void load()} className="font-semibold text-brand hover:underline">
            {t('elections.retry')}
          </button>
        </Notice>
      )}

      {state.kind === 'ready' && !seat && (
        <Notice tone="quiet" icon="info">
          {status === 'not-counting'
            ? t('elections.countNotStarted', { date: countingDate })
            : t('elections.countUnavailable')}
        </Notice>
      )}

      {state.kind === 'ready' && seat && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-soft">
              {t('elections.totalCounted', { n: seat.total_votes.toLocaleString('en-IN') })}
            </p>
            {seat.round && (
              <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-ink">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-ink opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-ink" />
                </span>
                {t('elections.round', { done: seat.round.done, total: seat.round.total })}
              </p>
            )}
          </div>

          {state.payload.status === 'stale' && (
            <div className="mb-3">
              <Notice tone="quiet" icon="clock">
                {t('elections.countStale')}
              </Notice>
            </div>
          )}

          <ul className="space-y-2">
            {sortRows(seat.rows).map((row, i) => (
              <CountRow
                key={`${row.name}-${i}`}
                row={row}
                seatSlug={seatSlug}
                isLeader={i === 0 && !row.isNota}
                final={false}
                tr={t}
              />
            ))}
          </ul>

          <CountCaveat sourceUrl={seat.source_url ?? officialUrl} tr={t} />
        </>
      )}
    </div>
  );
}

/** Highest first, with NOTA last regardless of its count - it is a ballot
 *  option, and slotting it among the candidates implies it is one. */
function sortRows(rows: ElectionResultRow[]): ElectionResultRow[] {
  return [...rows].sort((a, b) => Number(!!a.isNota) - Number(!!b.isNota) || b.total_votes - a.total_votes);
}

function Notice({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: 'warn' | 'quiet';
  icon: 'warn' | 'info' | 'clock';
}) {
  return (
    <p
      className={
        tone === 'warn'
          ? 'flex items-start gap-2 rounded-2xl border border-dashed border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-ink'
          : 'flex items-start gap-2 rounded-2xl border border-dashed border-line bg-paper-soft px-4 py-3 text-sm text-ink-soft'
      }
    >
      <Icon name={icon} size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
