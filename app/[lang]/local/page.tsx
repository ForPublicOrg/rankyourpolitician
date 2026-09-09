import Link from 'next/link';
import type { Metadata } from 'next';
import { getLocalBodies } from '@/lib/data';
import { getI18n, type LangParams } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import Breadcrumbs from '@/components/Breadcrumbs';
import HierarchyLadder from '@/components/HierarchyLadder';
import LocalBodyCard from '@/components/LocalBodyCard';
import { StatPill, PageHero, SectionCard } from '@/components/ui';
import { Reveal, CountUp } from '@/components/motion';
import Icon from '@/components/Icon';
import LastUpdated from '@/components/LastUpdated';
import AdSlot from '@/components/AdSlot';
import type { LocalBody } from '@/lib/types';

// Daily self-heal only - a mayor changes via the data manager + deploy, and
// every ISR regeneration is a billed write (see README "How data flows").
export const revalidate = 86400;
export { allLocaleStaticParams as generateStaticParams } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<LangParams> }): Promise<Metadata> {
  const { dict } = await getI18n((await params).lang);
  return {
    title: t(dict, 'local.metaTitle'),
    description: t(dict, 'local.metaDescription'),
    alternates: { canonical: '/local' },
  };
}

export default async function LocalPage({ params }: { params: Promise<LangParams> }) {
  const { lang } = await params;
  const [{ dict, locale }, bodies] = await Promise.all([getI18n(lang), getLocalBodies()]);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  const byState = new Map<string, { state: string; bodies: LocalBody[] }>();
  for (const b of bodies) {
    const cur = byState.get(b.stateCode) ?? { state: b.state, bodies: [] };
    cur.bodies.push(b);
    byState.set(b.stateCode, cur);
  }
  const states = [...byState.entries()].sort((a, b) => a[1].state.localeCompare(b[1].state));
  const heads = bodies.filter((b) => b.head).length;
  const administered = bodies.filter((b) => b.status === 'administrator').length;
  const updated = bodies.map((b) => b.retrieved_date).filter(Boolean).sort().pop();

  return (
    <>
      <PageHero
        crumbs={<Breadcrumbs items={[{ label: tr('levels.national'), href: '/' }, { label: tr('local.title') }]} />}
        title={tr('local.title')}
        subtitle={tr('local.subtitle')}
        aside={
          <div className="flex flex-wrap items-center gap-2.5">
            <StatPill value={<CountUp value={bodies.length} />} label={tr('local.statBodies')} tone="brand" />
            <StatPill value={<CountUp value={heads} />} label={tr('local.statHeads')} tone="perf" />
            {administered > 0 && <StatPill value={<CountUp value={administered} />} label={tr('local.statAdministrator')} tone="ink" />}
          </div>
        }
      />

      <div className="mx-auto max-w-content px-4 py-6">
        <HierarchyLadder current="district" />
        <div className="mt-3">
          <LastUpdated date={updated} />
        </div>

        <Reveal className="mt-5">
          <div className="glass rounded-3xl p-4 sm:p-5">
            <p className="flex items-start gap-2 text-sm text-ink-soft">
              <Icon name="info" size={16} className="mt-0.5 shrink-0 text-brand" />
              <span>{tr('local.verifiedNote')}</span>
            </p>
          </div>
        </Reveal>

        <div className="mt-6 space-y-6">
          {states.map(([code, st]) => (
            <Reveal key={code}>
              <SectionCard
                title={tr('local.stateTitle', { state: st.state })}
                icon="home"
                aside={
                  <Link href={`/state/${code}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                    {st.state} <Icon name="arrow" size={14} />
                  </Link>
                }
              >
                <div className="grid gap-3 md:grid-cols-2">
                  {st.bodies.map((b) => (
                    <LocalBodyCard key={b.id} body={b} tr={tr} locale={locale} />
                  ))}
                </div>
              </SectionCard>
            </Reveal>
          ))}
        </div>

        <div className="mt-8">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
