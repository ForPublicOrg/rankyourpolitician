import Link from 'next/link';
import type { Metadata } from 'next';
import { getCentralGovernment, getUnionMinistries } from '@/lib/data';
import { getI18n, type LangParams } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import { holdersOf } from '@/lib/ministries';
import { MINISTER_RANK_LABEL, type Minister, type UnionMinistry } from '@/lib/types';
import Breadcrumbs from '@/components/Breadcrumbs';
import HierarchyLadder from '@/components/HierarchyLadder';
import { Avatar, PartyChip, Chip, StatPill, PageHero, Eyebrow } from '@/components/ui';
import { Reveal, CountUp } from '@/components/motion';
import Icon from '@/components/Icon';
import LastUpdated from '@/components/LastUpdated';
import AdSlot from '@/components/AdSlot';

// Daily self-heal only - the schedule and the council list change via deploy,
// and every ISR regeneration is a billed write (see README "How data flows").
export const revalidate = 86400;
export { allLocaleStaticParams as generateStaticParams } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<LangParams> }): Promise<Metadata> {
  const { dict } = await getI18n((await params).lang);
  return {
    title: t(dict, 'ministries.metaTitle'),
    description: t(dict, 'ministries.metaDescription'),
    alternates: { canonical: '/india/ministries' },
  };
}

type Tr = (k: string, v?: Record<string, string | number>) => string;

export default async function MinistriesPage({ params }: { params: Promise<LangParams> }) {
  const { lang } = await params;
  const [{ dict, locale }, file, ministers] = await Promise.all([getI18n(lang), getUnionMinistries(), getCentralGovernment()]);
  const tr: Tr = (k, v) => t(dict, k, v);

  const entries = [...file.entries].sort((a, b) => a.order - b.order);
  const nMinistries = entries.filter((e) => e.kind === 'ministry').length;
  const nDepartments = entries.reduce((n, e) => n + e.departments.length, 0);

  return (
    <>
      <PageHero
        crumbs={
          <Breadcrumbs
            items={[
              { label: tr('levels.national'), href: '/' },
              { label: tr('central.title'), href: '/india' },
              { label: tr('ministries.title') },
            ]}
          />
        }
        title={tr('ministries.title')}
        subtitle={tr('ministries.subtitle')}
        aside={
          <div className="flex flex-wrap items-center gap-2.5">
            <StatPill value={<CountUp value={nMinistries} />} label={tr('ministries.statMinistries')} tone="brand" />
            <StatPill value={<CountUp value={nDepartments} />} label={tr('ministries.statDepartments')} tone="ink" />
          </div>
        }
      />

      <div className="mx-auto max-w-content px-4 py-6">
        <HierarchyLadder current="national" />

        {/* Provenance first: the one document that decides what a ministry is. */}
        <Reveal className="mt-5">
          <div className="glass rounded-3xl p-4 sm:p-5">
            <p className="flex items-start gap-2 text-sm text-ink-soft">
              <Icon name="law" size={16} className="mt-0.5 shrink-0 text-brand" />
              <span>{tr('ministries.sourceNote')}</span>
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-ink-faint">
              <a href={file.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand hover:underline">
                <Icon name="link" size={12} /> {file.source_name}
              </a>
              {file.schedule_last_updated && (
                <span>· {tr('ministries.scheduleUpdated')} {formatDate(file.schedule_last_updated, locale)}</span>
              )}
              <LastUpdated date={file.retrieved_date} />
            </p>
          </div>
        </Reveal>

        <ol className="mt-6 space-y-4">
          {entries.map((entry) => (
            <MinistryCard key={entry.id} entry={entry} ministers={ministers} tr={tr} />
          ))}
        </ol>

        <div className="mt-8">
          <AdSlot />
        </div>
      </div>
    </>
  );
}

function kindLabel(kind: UnionMinistry['kind'], tr: Tr): string {
  return kind === 'ministry' ? tr('ministries.kindMinistry') : kind === 'department' ? tr('ministries.kindDepartment') : tr('ministries.kindOffice');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function MinistryCard({ entry, ministers, tr }: { entry: UnionMinistry; ministers: Minister[]; tr: Tr }) {
  const { heads, mos } = holdersOf(entry, ministers);
  return (
    <li id={entry.id} className="glass scroll-mt-24 rounded-3xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <Eyebrow icon={entry.kind === 'ministry' ? 'building' : entry.kind === 'department' ? 'layers' : 'parliament'}>
            {kindLabel(entry.kind, tr)}
          </Eyebrow>
          <h2 className="mt-1 text-xl font-bold text-ink">{entry.name}</h2>
          {entry.name_hi_translit && <p className="mt-0.5 text-sm text-ink-faint">{entry.name_hi_translit}</p>}
          {entry.website && (
            <a
              href={entry.website}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-2 inline-flex items-center gap-1 text-sm text-brand hover:underline"
            >
              <Icon name="external" size={13} /> {tr('ministries.website')} · {hostOf(entry.website)}
            </a>
          )}

          {entry.departments.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                {tr('ministries.departments')} ({entry.departments.length})
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {entry.departments.map((d) => (
                  <li key={d.name}>
                    {d.website ? (
                      <a
                        href={d.website}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 rounded-full border border-line bg-white/85 px-3 py-1 text-sm text-ink-soft hover:border-brand hover:text-brand"
                        title={d.name_hi_translit}
                      >
                        {d.name} <Icon name="external" size={11} className="text-ink-faint" />
                      </a>
                    ) : (
                      <span className="inline-flex rounded-full border border-line bg-white/85 px-3 py-1 text-sm text-ink-soft" title={d.name_hi_translit}>
                        {d.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Who answers for it - straight from the cited council list. */}
        <div className="w-full shrink-0 space-y-3 lg:w-80">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{tr('ministries.heads')}</p>
            {heads.length === 0 ? (
              <p className="mt-1.5 rounded-xl bg-paper-soft p-3 text-sm text-ink-faint">{tr('ministries.noHead')}</p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {heads.map((m) => (
                  <MinisterRow key={m.id} m={m} />
                ))}
              </ul>
            )}
          </div>
          {mos.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{tr('ministries.mos')}</p>
              <ul className="mt-1.5 space-y-2">
                {mos.map((m) => (
                  <MinisterRow key={m.id} m={m} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function MinisterRow({ m }: { m: Minister }) {
  return (
    <li>
      <Link
        href={`/person/${m.politicianId || m.id}`}
        className="pressable flex items-center gap-3 rounded-2xl border border-line/70 bg-white/85 p-2.5 hover:border-brand/40 hover:shadow-soft"
      >
        <Avatar name={m.name} src={m.photo_url} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{m.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
            <Chip tone={m.rank === 'MoS' ? 'neutral' : 'brand'}>{MINISTER_RANK_LABEL[m.rank]}</Chip>
            <PartyChip party={m.party} />
          </span>
        </span>
        <Icon name="chevron" size={16} className="-rotate-90 shrink-0 text-ink-faint" />
      </Link>
    </li>
  );
}
