import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getAllElectionSeats, getCandidateSentiment, getElectionCandidate } from '@/lib/data';
import { getI18n } from '@/lib/i18n/server';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { candidateRatingId, phaseOf, ratingLockWindow } from '@/lib/elections';
import Breadcrumbs from '@/components/Breadcrumbs';
import { PageHero, SectionCard, Avatar, Chip, PartyChip } from '@/components/ui';
import { Reveal } from '@/components/motion';
import Icon from '@/components/Icon';
import DeclaredCases from '@/components/DeclaredCases';
import VoteWidget from '@/components/VoteWidget';
import { PhaseChip } from '@/components/ElectionBits';
import { StatTile } from '@/components/viz';
import type { ElectionCandidate, ElectionSeat } from '@/lib/types';

const FIELD_ICON = {
  assets_total: 'wallet',
  liabilities_total: 'briefcase',
  criminal_cases_declared: 'scales',
} as const;
const shortValue = (value: string) => value.split('(')[0].trim();
const leadNumber = (value: string) => value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0] ?? value.split(' ')[0];

export const revalidate = 604800;

export async function generateStaticParams() {
  const seats = await getAllElectionSeats();
  return seats.flatMap(({ seat }) =>
    seat.candidates.map((c) => ({ lang: DEFAULT_LOCALE, seat: seat.slug, candidate: c.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; seat: string; candidate: string }>;
}): Promise<Metadata> {
  const { lang, seat, candidate } = await params;
  const found = await getElectionCandidate(seat, candidate);
  const { dict } = await getI18n(lang);
  if (!found) return { title: t(dict, 'elections.title') };
  const title = `${found.candidate.name} - ${found.seat.constituencyName}, ${found.seat.state}`;
  const description = `${found.candidate.party}. ${t(dict, 'elections.candidateAboutHelp')}`;
  return {
    title,
    description,
    alternates: { canonical: `/elections/${seat}/${candidate}` },
    openGraph: { title, description, url: `/elections/${seat}/${candidate}` },
  };
}

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ lang: string; seat: string; candidate: string }>;
}) {
  const { lang, seat: seatSlug, candidate: candidateSlug } = await params;
  const found = await getElectionCandidate(seatSlug, candidateSlug);
  if (!found) notFound();
  const { event, seat, candidate } = found;

  // One human, one ratable page. A candidate who already holds office is rated
  // on their profile - keeping a second ratable page for the same person is how
  // one visitor ends up able to rate them twice.
  if (candidate.politicianId) redirect(`/person/${candidate.politicianId}`);

  const { dict, locale } = await getI18n(lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  const phase = phaseOf(event);
  const sentiment = await getCandidateSentiment(candidateRatingId(seat.slug, candidate.slug));
  const lock = ratingLockWindow(event);

  const casesFact = candidate.facts.find((f) => f.field_type === 'criminal_cases_declared');
  const resultRow = seat.result?.rows.find((r) => r.candidateSlug === candidate.slug);
  const won = seat.result?.winner_slug === candidate.slug;

  return (
    <>
      <PageHero
        crumbs={
          <Breadcrumbs
            items={[
              { label: tr('levels.national'), href: '/' },
              { label: tr('elections.title'), href: '/elections' },
              { label: seat.constituencyName, href: `/elections/${seat.slug}` },
              { label: candidate.name },
            ]}
          />
        }
        chips={
          <>
            <PhaseChip phase={phase} tr={tr} />
            <Chip tone={candidate.status === 'contesting' ? 'brand' : 'neutral'} icon="ballot">
              {tr(`elections.status.${candidate.status}`)}
            </Chip>
            {won && <Chip tone="perf" icon="check">{tr('elections.won')}</Chip>}
          </>
        }
        title={candidate.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <PartyChip party={candidate.party} />
            <span className="text-ink-faint">
              {tr('elections.seatOf', { seat: seat.constituencyName, state: seat.state })}
            </span>
          </span>
        }
        aside={<Avatar name={candidate.name} src={candidate.photo_path} size={96} />}
      />

      <div className="mx-auto max-w-content px-4 py-6">
        <div className="space-y-6">
          {/* The candidate page follows the profile-page hierarchy: an honest
              record snapshot beside the public-rating card, then full cited
              details. There is no invented performance score for a person who
              has not held office. */}
          <Reveal>
            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard
                title={tr('elections.candidateRecordTitle')}
                subtitle={tr('elections.candidateRecordHelp')}
                icon="ballot"
                className="h-full"
              >
                <CandidateRecord candidate={candidate} tr={tr} />
              </SectionCard>
              <SectionCard
                title={tr('elections.ratingTitle')}
                subtitle={tr('elections.ratingHelp')}
                icon="star"
                className="h-full"
              >
                <VoteWidget
                  politicianId={candidateRatingId(seat.slug, candidate.slug)}
                  personName={candidate.name}
                  initial={{
                    mean: sentiment.raw_mean,
                    votes: sentiment.n_votes,
                    distribution: sentiment.distribution,
                    confidence: sentiment.confidence,
                  }}
                  lockWindow={lock}
                />
              </SectionCard>
            </div>
          </Reveal>

          <div className="space-y-6">
            <Reveal>
              <SectionCard
                title={tr('elections.candidateAbout')}
                subtitle={tr('elections.candidateAboutHelp')}
                icon="info"
              >
                <DetailList candidate={candidate} seat={seat} tr={tr} />
                <SourceLine
                  url={candidate.source_url}
                  name={candidate.source_name}
                  retrieved={formatDate(candidate.retrieved_date, locale)}
                  tr={tr}
                />
                {candidate.affidavit_url && (
                  <a
                    href={candidate.affidavit_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
                  >
                    <Icon name="external" size={14} />
                    {tr('elections.affidavitLink')}
                  </a>
                )}
              </SectionCard>
            </Reveal>

            {/* The candidate's own sworn declaration of court cases - the same
                component, framing and disclaimers a sitting member's profile
                uses. An accusation is never presented as guilt. */}
            {casesFact && (
              <Reveal delay={60}>
                <DeclaredCases record={candidate.criminal} fact={casesFact} tr={tr} locale={locale} />
              </Reveal>
            )}
          </div>

          <div className="space-y-6">
            {resultRow && (
              <Reveal delay={40}>
                <SectionCard title={tr('elections.resultTitle')} icon="check">
                  <p className="text-3xl font-extrabold tabular-nums text-ink">
                    {resultRow.total_votes.toLocaleString('en-IN')}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-faint">
                    {tr('elections.votesLabel')} · {resultRow.vote_share_pct.toFixed(2)}%
                  </p>
                </SectionCard>
              </Reveal>
            )}

            <Reveal delay={120}>
              <Link
                href={`/elections/${seat.slug}`}
                className="pressable flex items-center gap-2 rounded-2xl border border-line bg-paper-soft p-4 text-sm font-semibold text-ink-soft transition hover:border-brand/40 hover:text-brand"
              >
                <Icon name="back" size={16} />
                {tr('elections.backToSeat', { seat: seat.constituencyName })}
              </Link>
            </Reveal>
          </div>
        </div>
      </div>
    </>
  );
}

/** A candidate's equivalent of the politician profile's record snapshot: only
 * sworn facts, never a made-up performance ranking. */
function CandidateRecord({
  candidate,
  tr,
}: {
  candidate: ElectionCandidate;
  tr: (k: string, v?: Record<string, string | number>) => string;
}) {
  const factOf = (type: keyof typeof FIELD_ICON) => candidate.facts.find((fact) => fact.field_type === type)?.value;
  const recordFields = Object.keys(FIELD_ICON) as (keyof typeof FIELD_ICON)[];
  const personal = [
    ['cap', tr('elections.fieldEducation'), candidate.facts.find((fact) => fact.field_type === 'education')?.value],
    ['briefcase', tr('elections.fieldProfession'), candidate.facts.find((fact) => fact.field_type === 'profession')?.value],
    ['calendar', tr('elections.fieldAge'), candidate.age ? String(candidate.age) : undefined],
  ] as const;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {recordFields.map((field) => {
          const value = factOf(field);
          const label =
            field === 'assets_total'
              ? tr('elections.fieldAssets')
              : field === 'liabilities_total'
                ? tr('elections.fieldLiabilities')
                : tr('profile.cases.title');
          return (
            <StatTile
              key={field}
              icon={FIELD_ICON[field]}
              value={value ? (field === 'criminal_cases_declared' ? leadNumber(value) : shortValue(value)) : tr('common.unavailable')}
              label={label}
              accent="ink"
            />
          );
        })}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {personal.map(([icon, label, value]) => (
          <div key={label} className="rounded-xl bg-paper-soft p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-faint">
              <Icon name={icon} size={14} /> {label}
            </p>
            <p className="mt-1 text-sm font-medium text-ink">{value ?? tr('common.unavailable')}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/** Everything the Election Commission publishes about this person, plus the
 *  affidavit figures. Absent fields are simply not listed - a blank row would
 *  imply we looked and found nothing, which is not the same as not knowing. */
function DetailList({
  candidate,
  seat,
  tr,
}: {
  candidate: ElectionCandidate;
  seat: ElectionSeat;
  tr: (k: string, v?: Record<string, string | number>) => string;
}) {
  const factOf = (type: string) => candidate.facts.find((f) => f.field_type === type)?.value;
  const rows: [string, string | undefined][] = [
    [tr('elections.fieldParty'), candidate.party_native ? `${candidate.party} · ${candidate.party_native}` : candidate.party],
    [tr('elections.fieldStatus'), tr(`elections.status.${candidate.status}`)],
    [tr('elections.fieldAge'), candidate.age ? String(candidate.age) : undefined],
    [tr('elections.fieldGender'), candidate.gender],
    [tr('elections.fieldRelative'), candidate.relative_name],
    [tr('elections.fieldFiled'), candidate.filed_on],
    [tr('elections.fieldEducation'), factOf('education')],
    [tr('elections.fieldProfession'), factOf('profession')],
    [tr('elections.fieldAssets'), factOf('assets_total')],
    [tr('elections.fieldLiabilities'), factOf('liabilities_total')],
    [tr('area.typeAc'), `${seat.constituencyName}${seat.acNumber ? ` (${seat.acNumber})` : ''}`],
  ];
  return (
    <dl className="divide-y divide-line/60">
      {rows
        .filter(([, v]) => !!v)
        .map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
            <dt className="min-w-0 text-sm text-ink-soft">{label}</dt>
            <dd className="min-w-0 text-sm font-semibold text-ink">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function SourceLine({
  url,
  name,
  retrieved,
  tr,
}: {
  url: string;
  name: string;
  retrieved: string;
  tr: (k: string, v?: Record<string, string | number>) => string;
}) {
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-xs text-ink-faint">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="inline-flex items-center gap-1 text-brand hover:underline"
      >
        <Icon name="link" size={12} /> {tr('common.source')}: {name}
      </a>
      <span>
        · {tr('common.lastUpdated')} {retrieved}
      </span>
    </p>
  );
}
