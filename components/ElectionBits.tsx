// Presentational pieces shared by the election hub, seat and candidate pages.
// No hooks - safe from a server component (the live count is the only client
// piece, and it lives in LiveCount.tsx).
import Link from 'next/link';
import { clsx } from 'clsx';
import { Avatar, Chip, PartyChip } from './ui';
import Icon from './Icon';
import type { ElectionCandidate, ElectionPhase, ElectionResultRow, ElectionSeat } from '@/lib/types';

type Tr = (k: string, v?: Record<string, string | number>) => string;

/** The small, serialisable piece of a candidate record that a live count needs
 * to turn a bare name into the same recognisable person card used elsewhere. */
export type CountCandidate = Pick<ElectionCandidate, 'slug' | 'name' | 'name_native' | 'photo_path'>;

/** Phase as a colour-coded pill. Only a live count gets the warm tone, so
 *  "Counting now" reads as the exception it is rather than one badge of six. */
export function PhaseChip({ phase, tr }: { phase: ElectionPhase; tr: Tr }) {
  const key = phase === 'awaiting-count' ? 'awaitingCount' : phase;
  const tone =
    phase === 'counting' || phase === 'polling' ? 'warn' : phase === 'declared' ? 'neutral' : 'brand';
  const icon = phase === 'declared' ? 'check' : phase === 'counting' ? 'sparkle' : 'calendar';
  return (
    <Chip tone={tone} icon={icon}>
      {tr(`elections.phase.${key}`)}
    </Chip>
  );
}

/** "in 12 days" / "tomorrow" / "today". Rendered from the server's clock, which
 *  can be a week stale on an ISR page - <LiveCount> and the phase chip are the
 *  parts that must be exact, and they refresh in the browser. */
export function When({ days, tr }: { days: number; tr: Tr }) {
  if (days <= 0) return <>{tr('elections.whenToday')}</>;
  if (days === 1) return <>{tr('elections.whenTomorrow')}</>;
  return <>{tr('elections.whenDays', { n: days })}</>;
}

/**
 * One candidate row. Deliberately flat: photo, name, party, and at most one
 * factual chip. No score, no ordering signal, nothing that reads as a verdict -
 * the order comes from the Election Commission and is stated as such.
 */
export function CandidateRow({
  candidate,
  seatSlug,
  tr,
  trailing,
}: {
  candidate: ElectionCandidate;
  seatSlug: string;
  tr: Tr;
  trailing?: React.ReactNode;
}) {
  const cases = candidate.criminal?.declared_total ?? 0;
  return (
    <Link
      href={`/elections/${seatSlug}/${candidate.slug}`}
      className="pressable flex items-center gap-3 rounded-2xl border border-line bg-paper-soft p-3 transition hover:border-brand/40 hover:shadow-lift sm:gap-4 sm:p-4"
    >
      <Avatar name={candidate.name} src={candidate.photo_path} size={48} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-ink">{candidate.name}</p>
        {candidate.name_native && (
          <p className="truncate text-sm text-ink-faint" lang="">
            {candidate.name_native}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <PartyChip party={candidate.party} />
          {cases > 0 && (
            <Chip tone="warn" icon="law">
              {tr('profile.cases.declaredCount', { n: cases })}
            </Chip>
          )}
        </div>
      </div>
      {trailing}
      <Icon name="chevron" size={16} className="shrink-0 -rotate-90 text-ink-faint" />
    </Link>
  );
}

/**
 * One row of a count. The bar is a single neutral colour for everyone - vote
 * share is the only thing its length may encode. Parties are never given their
 * brand colours here (same rule as CompositionBar in viz.tsx); the leader is
 * marked with a word, which a colourblind reader can also read.
 */
export function CountRow({
  row,
  seatSlug,
  isLeader,
  final,
  tr,
  candidate,
}: {
  row: ElectionResultRow;
  seatSlug: string;
  isLeader: boolean;
  final: boolean;
  tr: Tr;
  candidate?: CountCandidate;
}) {
  const pct = Math.max(0, Math.min(100, row.vote_share_pct));
  const body = (
    <>
      <div className="flex min-w-0 items-start gap-3">
        {candidate && <Avatar name={candidate.name} src={candidate.photo_path} size={44} />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <div className="min-w-0">
              {/* On phones the party moves below a long name, preserving room
                  for the exact total on the right. Desktop has enough space
                  to return to the compact inline treatment. */}
              <div className="flex min-w-0 flex-col gap-0.5 lg:flex-row lg:items-baseline lg:gap-2">
                <span className={clsx('min-w-0 break-words text-sm leading-tight lg:truncate', isLeader ? 'font-extrabold text-ink' : 'font-semibold text-ink-soft')}>
                  {row.isNota ? tr('elections.nota') : row.name}
                </span>
                {!row.isNota && <span className="min-w-0 truncate text-xs text-ink-faint">{row.party}</span>}
              </div>
              {candidate?.name_native && (
                <p className="truncate text-xs text-ink-faint" lang="">{candidate.name_native}</p>
              )}
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
              {row.total_votes.toLocaleString('en-IN')}
              <span className="ml-1.5 text-xs font-semibold text-ink-faint">{pct.toFixed(2)}%</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper-sink">
            <div
              className={clsx('h-full rounded-full', isLeader ? 'bg-brand' : 'bg-ink-faint/40')}
              style={{ width: `${pct}%` }}
            />
          </div>
          {isLeader && !row.isNota && (
            <p className="mt-1.5">
              <Chip tone={final ? 'perf' : 'warn'} icon={final ? 'check' : 'sparkle'}>
                {final ? tr('elections.won') : tr('elections.leading')}
              </Chip>
            </p>
          )}
        </div>
      </div>
    </>
  );

  // NOTA is a ballot option, not a person: it never links anywhere.
  if (row.isNota || !row.candidateSlug) {
    return <li className="h-full rounded-2xl border border-line bg-paper-soft p-3">{body}</li>;
  }
  return (
    <li className="h-full">
      <Link
        href={`/elections/${seatSlug}/${row.candidateSlug}`}
        className="pressable block h-full rounded-2xl border border-line bg-paper-soft p-3 transition hover:border-brand/40 hover:shadow-lift"
      >
        {body}
      </Link>
    </li>
  );
}

/** The Election Commission's own caveat, reproduced rather than paraphrased,
 *  plus a way to check us against them. Shown wherever a count is. */
export function CountCaveat({ sourceUrl, tr }: { sourceUrl?: string; tr: Tr }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-line bg-paper-soft p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
        <Icon name="info" size={13} />
        {tr('elections.notFinalTitle')}
      </p>
      <p className="mt-1 text-sm text-ink-soft">{tr('elections.notFinalBody')}</p>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
        >
          {tr('elections.officialLink')} <Icon name="external" size={13} />
        </a>
      )}
    </div>
  );
}

/** Card for one seat on the hub. Answers where, when, and how many are standing
 *  - in that order, because that is the order a reader asks them in. */
export function SeatCard({
  seat,
  phase,
  days,
  tr,
}: {
  seat: ElectionSeat;
  phase: ElectionPhase;
  days: number;
  tr: Tr;
}) {
  const standing = seat.candidates.filter((c) => c.status === 'contesting').length;
  const winner = seat.result?.rows.find((r) => r.candidateSlug && r.candidateSlug === seat.result?.winner_slug);
  return (
    <Link
      href={`/elections/${seat.slug}`}
      className="pressable flex h-full flex-col rounded-3xl border border-line bg-paper-soft p-4 transition hover:border-brand/40 hover:shadow-lift sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <PhaseChip phase={phase} tr={tr} />
        <Chip tone="neutral" icon="pin">{seat.state}</Chip>
      </div>
      <p className="mt-2.5 text-xl font-extrabold tracking-tight text-ink">{seat.constituencyName}</p>
      <p className="mt-0.5 text-sm text-ink-faint">
        {seat.acNumber ? `${tr('area.typeAc')} ${seat.acNumber}` : tr('area.typeAc')}
        {seat.districts.length > 0 && ` · ${seat.districts.join(', ')}`}
      </p>

      {winner ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <Icon name="check" size={15} className="text-perf" />
          <span className="min-w-0 truncate">
            <span className="font-bold text-ink">{winner.name}</span> · {winner.party}
          </span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">
          {standing === 1 ? tr('elections.standingOne') : tr('elections.standingMany', { n: standing })}
          {phase !== 'declared' && days > 0 && <> · <When days={days} tr={tr} /></>}
        </p>
      )}

      <span className="mt-auto pt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand">
        {seat.result ? tr('elections.seeResult') : tr('elections.seeSeat')} <Icon name="arrow" size={14} />
      </span>
    </Link>
  );
}
