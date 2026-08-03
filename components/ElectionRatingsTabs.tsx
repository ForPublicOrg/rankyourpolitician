'use client';
// Candidate ratings are useful only in the context of a single ballot. This
// tiny, lazy tab set deliberately does not reuse the national leader endpoint:
// it fetches one compact, seat-scoped list after the reader reaches the card.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { observe } from '@/components/motion';
import { Avatar, PartyChip } from '@/components/ui';
import Icon from '@/components/Icon';
import { RankBadge } from '@/components/viz';
import { ListSkeleton, LoadError, type Remote } from '@/components/TrendingList';
import type { ElectionCandidateRatingEntry } from '@/lib/types';

type Tab = 'trending' | 'top';

export default function ElectionRatingsTabs({ seatSlug }: { seatSlug: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('trending');
  const [trending, setTrending] = useState<Remote<ElectionCandidateRatingEntry>>({ status: 'idle' });
  const [top, setTop] = useState<Remote<ElectionCandidateRatingEntry>>({ status: 'idle' });
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = { trending: useRef<HTMLButtonElement>(null), top: useRef<HTMLButtonElement>(null) };
  const started = useRef<Record<Tab, boolean>>({ trending: false, top: false });

  const load = useCallback((next: Tab) => {
    started.current[next] = true;
    const update = next === 'trending' ? setTrending : setTop;
    update({ status: 'loading' });
    const qs = new URLSearchParams({ seat: seatSlug, mode: next, limit: '5' });
    fetch(`/api/election-ratings?${qs.toString()}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => update({ status: 'ready', entries: data?.entries ?? [] }))
      .catch(() => update({ status: 'error' }));
  }, [seatSlug]);

  // The initial tab is deferred until it is useful. Pages with no interest in
  // ratings keep their static, CDN-served HTML and make no ranking request.
  useEffect(() => {
    if (started.current.trending) return;
    const element = rootRef.current;
    if (!element) return;
    if (element.getBoundingClientRect().top < window.innerHeight) {
      load('trending');
      return;
    }
    return observe(element, () => {
      if (!started.current.trending) load('trending');
    });
  }, [load]);

  const switchTab = (next: Tab) => {
    setTab(next);
    if (!started.current[next]) load(next);
  };
  const tabs: { key: Tab; label: string; icon: 'sparkle' | 'star' }[] = [
    { key: 'trending', label: t('trending.tab'), icon: 'sparkle' },
    { key: 'top', label: t('trending.tabTop'), icon: 'star' },
  ];
  const current = tab === 'trending' ? trending : top;

  return (
    <div ref={rootRef}>
      <div
        role="tablist"
        aria-label={t('elections.candidateRatingsTitle')}
        className="mb-3 inline-flex rounded-full bg-paper-sink p-1"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next = tabs[(tabs.findIndex((item) => item.key === tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].key;
          switchTab(next);
          tabRefs[next].current?.focus();
        }}
      >
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            ref={tabRefs[key]}
            type="button"
            role="tab"
            id={`candidate-ratings-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="candidate-ratings-panel"
            tabIndex={tab === key ? 0 : -1}
            onClick={() => switchTab(key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              tab === key ? 'bg-white text-ink shadow-soft' : 'text-ink-faint hover:text-ink'
            }`}
          >
            <Icon name={icon} size={14} className="mr-1 inline-block -translate-y-px" />
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="candidate-ratings-panel" aria-labelledby={`candidate-ratings-tab-${tab}`}>
        <p className="mb-3 text-sm text-ink-faint">
          {tab === 'trending' ? t('elections.candidateTrendingHelp') : t('elections.candidateTopRatedHelp')}
        </p>
        <CandidateRatingsPanel state={current} mode={tab} seatSlug={seatSlug} onRetry={() => load(tab)} />
      </div>
    </div>
  );
}

function CandidateRatingsPanel({
  state,
  mode,
  seatSlug,
  onRetry,
}: {
  state: Remote<ElectionCandidateRatingEntry>;
  mode: Tab;
  seatSlug: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (state.status === 'idle' || state.status === 'loading') {
    return <ListSkeleton label={t('elections.candidateRatingsLoading')} rows={5} />;
  }
  if (state.status === 'error') return <LoadError message={t('elections.candidateRatingsError')} onRetry={onRetry} />;
  if (state.entries.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-paper-soft px-4 py-5 text-sm text-ink-soft">
        <Icon name={mode === 'trending' ? 'sparkle' : 'star'} size={18} className="shrink-0 text-rating-ink" />
        {mode === 'trending' ? t('elections.candidateTrendingEmpty') : t('elections.candidateTopRatedEmpty')}
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {state.entries.map((entry, index) => (
        <li key={entry.candidate_slug}>
          <Link
            href={`/elections/${seatSlug}/${entry.candidate_slug}`}
            className="pressable flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 transition hover:border-brand/40 hover:shadow-lift"
          >
            <RankBadge rank={index + 1} />
            <Avatar name={entry.name} src={entry.photo_url} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="truncate text-sm font-bold text-ink">{entry.name}</span>
                <PartyChip party={entry.party} />
              </div>
              <p className="mt-0.5 text-xs text-ink-faint">
                {mode === 'trending'
                  ? entry.recent_votes === 1
                    ? t('trending.oneThisWeek')
                    : t('trending.thisWeek', { n: entry.recent_votes ?? 0 })
                  : entry.total_votes === 1
                    ? t('ranking.voteOne')
                    : t('ranking.votes', { n: entry.total_votes })}
              </p>
            </div>
            {entry.rating_mean != null && (
              <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-rating-ink">
                {entry.rating_mean.toFixed(1)}
                <Icon name="star" size={13} style={{ fill: 'currentColor' }} />
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}
