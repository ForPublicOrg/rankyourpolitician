import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAllElectionSeats, getElectionSeat } from '@/lib/data';
import { getI18n } from '@/lib/i18n/server';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { daysUntil, keyDateFor, phaseOf } from '@/lib/elections';
import { constituencyCandidateUrl } from '@/lib/eci-results';
import Breadcrumbs from '@/components/Breadcrumbs';
import { PageHero, SectionCard, Chip } from '@/components/ui';
import { Reveal } from '@/components/motion';
import Icon from '@/components/Icon';
import LiveCount from '@/components/LiveCount';
import { CandidateRow, CountCaveat, CountRow, PhaseChip, When } from '@/components/ElectionBits';
import type { ElectionCandidate, ElectionEvent, ElectionSeat, NominationStatus } from '@/lib/types';

// Weekly self-heal, like every other long-tail page: an ISR regeneration is a
// billed write, and nothing that changes faster than a deploy is baked in here
// - the count is client-fetched and the phase is computed from the schedule.
export const revalidate = 604800;

// Prebuild English only. Other locales render on demand and ISR-cache, the same
// trade the person/area/state pages make - fanning 23 locales across every seat
// would multiply the build for pages almost nobody asks for.
export async function generateStaticParams() {
  const seats = await getAllElectionSeats();
  return seats.map(({ seat }) => ({ lang: DEFAULT_LOCALE, seat: seat.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; seat: string }>;
}): Promise<Metadata> {
  const { lang, seat } = await params;
  const found = await getElectionSeat(seat);
  const { dict } = await getI18n(lang);
  if (!found) return { title: t(dict, 'elections.title') };
  const standing = found.seat.candidates.filter((c) => c.status === 'contesting').length;
  const title = `${found.seat.constituencyName}, ${found.seat.state} - ${t(dict, 'elections.title')}`;
  const description = t(dict, 'elections.candidatesHelp', { n: found.seat.candidates.length })
    .replace(/\.$/, '') + `. ${standing} on the ballot.`;
  return {
    title,
    description,
    alternates: { canonical: `/elections/${seat}` },
    openGraph: { title, description, url: `/elections/${seat}` },
  };
}

const GROUPS: { status: NominationStatus; titleKey: string; helpKey: string }[] = [
  { status: 'contesting', titleKey: 'elections.groupContesting', helpKey: 'elections.groupContestingHelp' },
  { status: 'withdrawn', titleKey: 'elections.groupWithdrawn', helpKey: 'elections.groupWithdrawnHelp' },
  { status: 'rejected', titleKey: 'elections.groupRejected', helpKey: 'elections.groupRejectedHelp' },
];

export default async function SeatPage({ params }: { params: Promise<{ lang: string; seat: string }> }) {
  const { lang, seat: seatSlug } = await params;
  const found = await getElectionSeat(seatSlug);
  if (!found) notFound();
  const { event, seat } = found;

  const { dict, locale } = await getI18n(lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  const phase = phaseOf(event);
  const key = keyDateFor(event, phase);
  const days = daysUntil(key.date, phase === 'counting' ? '07:30' : event.schedule.pollClose);
  const phaseKey = phase === 'awaiting-count' ? 'awaitingCount' : phase;

  const officialUrl = event.results_base
    ? constituencyCandidateUrl(event.results_base, seat.eci.stateCode, seat.eci.acNo)
    : undefined;

  const result = seat.result;
  const resultRows = result
    ? [...result.rows].sort((a, b) => Number(!!a.isNota) - Number(!!b.isNota) || b.total_votes - a.total_votes)
    : [];

  return (
    <>
      <PageHero
        crumbs={
          <Breadcrumbs
            items={[
              { label: tr('levels.national'), href: '/' },
              { label: tr('elections.title'), href: '/elections' },
              { label: seat.constituencyName },
            ]}
          />
        }
        chips={
          <>
            <PhaseChip phase={phase} tr={tr} />
            <Chip tone="neutral" icon="pin">{seat.state}</Chip>
            {seat.acNumber && <Chip tone="neutral">{`${tr('area.typeAc')} ${seat.acNumber}`}</Chip>}
          </>
        }
        title={seat.constituencyName}
        subtitle={
          <>
            {tr(`elections.phaseHelp.${phaseKey}`, { date: formatDate(key.date, locale) })}
            {phase !== 'declared' && days > 0 && (
              <>
                {' '}
                <span className="font-semibold text-ink">
                  (<When days={days} tr={tr} />)
                </span>
              </>
            )}
          </>
        }
        aside={
          <Link
            href={`/area/${seat.constituencyId}`}
            className="pressable inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink-soft hover:border-brand/40 hover:text-brand"
          >
            <Icon name="map" size={15} />
            {tr('area.typeAc')}
          </Link>
        }
      />

      <div className="mx-auto max-w-content space-y-6 px-4 py-6">
        {/* The count comes first once there is one - it is why anyone is here
            today. Before counting day this whole block is absent rather than an
            empty shell promising numbers that do not exist. */}
        {result ? (
          <Reveal>
            <SectionCard title={tr('elections.resultTitle')} subtitle={tr('elections.resultHelp')} icon="check">
              <p className="mb-3 text-sm font-semibold text-ink-soft">
                {tr('elections.totalVotes', { n: (result.total_votes ?? 0).toLocaleString('en-IN') })}
                {result.margin != null && <> · {tr('elections.marginWon', { n: result.margin.toLocaleString('en-IN') })}</>}
              </p>
              <ul className="space-y-2">
                {resultRows.map((row, i) => (
                  <CountRow
                    key={`${row.name}-${i}`}
                    row={row}
                    seatSlug={seat.slug}
                    isLeader={i === 0 && !row.isNota}
                    final
                    tr={tr}
                  />
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-faint">
                <a
                  href={result.source_url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 hover:text-brand hover:underline"
                >
                  <Icon name="link" size={12} />
                  {result.source_name}
                </a>
              </p>
            </SectionCard>
          </Reveal>
        ) : phase === 'counting' || phase === 'awaiting-count' ? (
          <Reveal>
            <SectionCard title={tr('elections.liveCountTitle')} subtitle={tr('elections.liveCountHelp')} icon="sparkle">
              <LiveCount
                eventId={event.id}
                seatSlug={seat.slug}
                expectedRows={seat.candidates.filter((c) => c.status === 'contesting').length}
                officialUrl={officialUrl}
                countingDate={event.schedule.countingDate}
              />
            </SectionCard>
          </Reveal>
        ) : (
          phase === 'declared' &&
          officialUrl && (
            // Counting is over but `dm fetch-election-results` has not run yet.
            // Rather than a page that silently omits the result, say plainly
            // that the Commission has it and send the reader there. The gap is
            // hours at most, and an honest pointer beats a blank.
            <Reveal>
              <SectionCard title={tr('elections.resultTitle')} icon="check">
                <p className="text-sm text-ink-soft">{tr('elections.phaseHelp.declared')}</p>
                <a
                  href={officialUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="pressable mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:shadow-lift"
                >
                  {tr('elections.officialLink')} <Icon name="external" size={14} />
                </a>
              </SectionCard>
            </Reveal>
          )
        )}

        <div // grid-cols-1 is load-bearing: without an explicit base column the
          // implicit track sizes to min-content and drags the page sideways on a
          // phone - the overflow class this repo has been bitten by before.
          className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Reveal delay={60}>
              <CandidateGroups seat={seat} tr={tr} />
            </Reveal>
          </div>

          <div className="space-y-6">
            <Reveal delay={100}>
              <ScheduleCard event={event} tr={tr} locale={locale} />
            </Reveal>
            {!result && phase !== 'counting' && officialUrl && (
              <Reveal delay={140}>
                <SectionCard title={tr('elections.sourceEci')} icon="link">
                  <CountCaveat sourceUrl={officialUrl} tr={tr} />
                </SectionCard>
              </Reveal>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function CandidateGroups({
  seat,
  tr,
}: {
  seat: ElectionSeat;
  tr: (k: string, v?: Record<string, string | number>) => string;
}) {
  const groups = GROUPS.map((g) => ({
    ...g,
    people: seat.candidates.filter((c) => c.status === g.status || (g.status === 'contesting' && c.status === 'accepted')),
  })).filter((g) => g.people.length > 0);

  return (
    <SectionCard
      title={tr('elections.candidatesTitle')}
      subtitle={tr('elections.candidatesHelp', { n: seat.candidates.length })}
      icon="people"
    >
      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.status}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wider text-ink-faint">{tr(g.titleKey)}</h3>
              <span className="text-xs text-ink-faint">{g.people.length}</span>
            </div>
            <p className="mb-2.5 text-sm text-ink-soft">{tr(g.helpKey)}</p>
            <div className="space-y-2">
              {g.people.map((c: ElectionCandidate) => (
                <CandidateRow key={c.slug} candidate={c} seatSlug={seat.slug} tr={tr} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-faint">
        <Icon name="info" size={13} className="mt-0.5 shrink-0" />
        {tr('elections.notRanked')}
      </p>
    </SectionCard>
  );
}

function ScheduleCard({
  event,
  tr,
  locale,
}: {
  event: ElectionEvent;
  tr: (k: string, v?: Record<string, string | number>) => string;
  locale: string;
}) {
  const rows: { key: keyof ElectionEvent['schedule']; label: string }[] = [
    { key: 'notification', label: 'notification' },
    { key: 'nominationLast', label: 'nominationLast' },
    { key: 'scrutiny', label: 'scrutiny' },
    { key: 'withdrawalLast', label: 'withdrawalLast' },
    { key: 'pollDate', label: 'pollDate' },
    { key: 'countingDate', label: 'countingDate' },
  ];
  return (
    <SectionCard title={tr('elections.scheduleTitle')} subtitle={tr('elections.scheduleHelp')} icon="calendar">
      <ul className="space-y-2">
        {rows.map((r) => {
          const value = event.schedule[r.key];
          if (!value) return null;
          return (
            <li key={r.key} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-2 last:border-0 last:pb-0">
              <span className="min-w-0 text-sm text-ink-soft">{tr(`elections.schedule.${r.label}`)}</span>
              <span className="shrink-0 text-sm font-semibold text-ink">{formatDate(value, locale)}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-faint">
        {tr('elections.pollHours', { from: event.schedule.pollOpen, to: event.schedule.pollClose })}
      </p>
    </SectionCard>
  );
}
