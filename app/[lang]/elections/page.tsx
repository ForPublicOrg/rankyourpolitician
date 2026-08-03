import Link from 'next/link';
import type { Metadata } from 'next';
import { getElections } from '@/lib/data';
import { getI18n, type LangParams } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { daysUntil, isActivePhase, keyDateFor, phaseOf } from '@/lib/elections';
import Breadcrumbs from '@/components/Breadcrumbs';
import { PageHero, SectionCard, StatPill, Chip } from '@/components/ui';
import { CountUp, Reveal } from '@/components/motion';
import Icon from '@/components/Icon';
import LastUpdated from '@/components/LastUpdated';
import { SeatCard } from '@/components/ElectionBits';
import type { ElectionEvent } from '@/lib/types';

// Daily self-heal only. Nothing on this page is minute-fresh: the phase labels
// and countdowns are computed from the cited schedule, and the one genuinely
// live thing - the count - is client-fetched on the seat pages.
export const revalidate = 86400;
export { allLocaleStaticParams as generateStaticParams } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<LangParams> }): Promise<Metadata> {
  const { dict } = await getI18n((await params).lang);
  return {
    title: t(dict, 'elections.metaTitle'),
    description: t(dict, 'elections.metaDescription'),
    alternates: { canonical: '/elections' },
    openGraph: {
      title: t(dict, 'elections.metaTitle'),
      description: t(dict, 'elections.metaDescription'),
    },
  };
}

export default async function ElectionsPage({ params }: { params: Promise<LangParams> }) {
  const { lang } = await params;
  const { dict, locale } = await getI18n(lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  const events = await getElections();
  const withPhase = events.map((event) => ({ event, phase: phaseOf(event) }));
  const live = withPhase.filter((x) => isActivePhase(x.phase));
  const past = withPhase.filter((x) => !isActivePhase(x.phase));

  const seatsLive = live.reduce((n, x) => n + x.event.seats.length, 0);
  const standingLive = live.reduce(
    (n, x) => n + x.event.seats.reduce((m, s) => m + s.candidates.filter((c) => c.status === 'contesting').length, 0),
    0,
  );
  const updated = events.map((e) => e.retrieved_date).filter(Boolean).sort().pop();

  return (
    <>
      <PageHero
        crumbs={<Breadcrumbs items={[{ label: tr('levels.national'), href: '/' }, { label: tr('elections.title') }]} />}
        chips={<Chip tone="brand" icon="ballot">{tr('elections.sourceEci')}</Chip>}
        title={tr('elections.title')}
        subtitle={tr('elections.subtitle')}
        aside={
          live.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <StatPill value={<CountUp value={seatsLive} />} label={tr('elections.liveTitle')} tone="brand" />
              <StatPill value={<CountUp value={standingLive} />} label={tr('elections.candidatesTitle')} tone="ink" />
            </div>
          ) : undefined
        }
      />

      <div className="mx-auto max-w-content space-y-6 px-4 py-6">
        <LastUpdated date={updated} />

        {live.length === 0 && past.length === 0 && <EmptyState tr={tr} />}

        {live.map(({ event, phase }, i) => (
          <Reveal key={event.id} delay={i * 60}>
            <EventSection event={event} live tr={tr} locale={locale} />
          </Reveal>
        ))}

        {live.length === 0 && past.length > 0 && (
          <Reveal>
            <NoneRunning tr={tr} />
          </Reveal>
        )}

        {past.length > 0 && (
          <Reveal delay={80}>
            <div>
              <h2 className="mb-3 flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight text-ink">
                <Icon name="clock" size={20} className="text-ink-faint" />
                {tr('elections.pastTitle')}
              </h2>
              <p className="mb-4 text-sm text-ink-soft">{tr('elections.pastHelp')}</p>
              <div className="space-y-6">
                {past.map((x) => (
                  <EventSection key={x.event.id} event={x.event} live={false} tr={tr} locale={locale} />
                ))}
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </>
  );
}

function EventSection({
  event,
  live,
  tr,
  locale,
}: {
  event: ElectionEvent;
  live: boolean;
  tr: (k: string, v?: Record<string, string | number>) => string;
  locale: string;
}) {
  const phase = phaseOf(event);
  const key = keyDateFor(event, phase);
  const days = daysUntil(key.date, phase === 'counting' ? '07:30' : event.schedule.pollClose);

  return (
    <SectionCard
      icon="ballot"
      eyebrow={live ? tr('elections.liveTitle') : undefined}
      title={event.title}
      subtitle={tr(`elections.phaseHelp.${phase === 'awaiting-count' ? 'awaitingCount' : phase}`, {
        date: formatDate(key.date, locale),
      })}
      aside={
        <span className="shrink-0 text-sm text-ink-faint">
          {event.seats.length === 1 ? tr('elections.seatsOne') : tr('elections.seatsMany', { n: event.seats.length })}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {event.seats.map((seat) => (
          <SeatCard key={seat.slug} seat={seat} phase={phase} days={days} tr={tr} />
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-faint">
        <a
          href={event.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 hover:text-brand hover:underline"
        >
          <Icon name="link" size={12} />
          {event.source_name}
        </a>
      </p>
    </SectionCard>
  );
}

/** Shown when an election exists in the archive but none is running. Honest
 *  about the quiet, and useful anyway. */
function NoneRunning({ tr }: { tr: (k: string) => string }) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-paper-soft p-5 text-center sm:p-6">
      <span className="mx-auto inline-grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Icon name="ballot" size={22} />
      </span>
      <p className="mt-3 text-lg font-bold text-ink">{tr('elections.emptyTitle')}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-ink-soft">{tr('elections.emptyHelp')}</p>
    </div>
  );
}

/** The genuinely-empty case: no election, past or present. Never a dead end -
 *  it hands the reader back to the thing this site is actually for. */
function EmptyState({ tr }: { tr: (k: string) => string }) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-paper-soft p-6 text-center sm:p-10">
      <span className="mx-auto inline-grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Icon name="ballot" size={24} />
      </span>
      <p className="mt-3 text-xl font-extrabold text-ink">{tr('elections.emptyTitle')}</p>
      <p className="mx-auto mt-2 max-w-xl text-ink-soft">{tr('elections.emptyHelp')}</p>
      <p className="mx-auto mt-3 max-w-xl text-sm text-ink-faint">{tr('elections.emptyMeanwhile')}</p>
      <Link
        href="/search"
        className="pressable mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:shadow-lift"
      >
        {tr('elections.findMyArea')} <Icon name="arrow" size={15} />
      </Link>
    </div>
  );
}
