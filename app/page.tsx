import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import { getNationalRanking, getStates, getDatasetMeta, getCentralGovernment, getNationalStats } from '@/lib/data';
import { buildStatePaths } from '@/lib/geo';
import SearchBox from '@/components/SearchBox';
import GeoMap, { type GeoMapShape } from '@/components/GeoMap';
import RankingList from '@/components/RankingList';
import LastUpdated from '@/components/LastUpdated';
import AdSlot from '@/components/AdSlot';
import HierarchyLadder from '@/components/HierarchyLadder';
import { SectionCard, Avatar, PartyChip, Chip, StatPill, Eyebrow } from '@/components/ui';
import { ScoreRing, Stars } from '@/components/viz';
import { Reveal, CountUp } from '@/components/motion';
import Icon, { type IconName } from '@/components/Icon';

export const revalidate = 300;

export default async function HomePage() {
  const { dict } = await getI18n();
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  const [ranking, states, meta, central, stats] = await Promise.all([
    getNationalRanking(),
    getStates(),
    getDatasetMeta(),
    getCentralGovernment(),
    getNationalStats(),
  ]);
  const paths = buildStatePaths();
  const countByCode = new Map(states.map((s) => [s.stateCode, s.count]));
  const maxCount = Math.max(1, ...states.map((s) => s.count));
  const shapes: GeoMapShape[] = paths.map((p) => {
    const count = p.code ? countByCode.get(p.code) : undefined;
    return {
      name: p.name,
      d: p.d,
      cx: p.cx,
      cy: p.cy,
      href: p.code && count ? `/state/${p.code}` : undefined,
      sub: count ? tr('home.mapLeaders', { n: count }) : undefined,
      value: count ? Math.sqrt(count / maxCount) : null,
    };
  });

  const pm = central.find((m) => m.rank === 'PM');
  const topCabinet = central.filter((m) => m.rank === 'Cabinet').slice(0, 5);
  const examples = ['Mandi', 'Goa', 'Anurag Thakur'];
  const tiers: { role: string; icon: IconName; tint: string }[] = [
    { role: 'lokSabha', icon: 'parliament', tint: 'bg-brand-soft text-brand' },
    { role: 'vidhanSabha', icon: 'flag', tint: 'bg-perf-soft text-perf' },
    { role: 'localBody', icon: 'home', tint: 'bg-rating-soft text-rating-ink' },
  ];

  return (
    <>
      {/* HERO — search + the living map of India */}
      <section className="relative overflow-hidden border-b border-line/60">
        <div className="mx-auto max-w-content px-4 pb-10 pt-10 sm:pt-14">
          <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr]">
            <div className="text-center lg:text-left">
              <h1 className="animate-fade-up font-display text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
                {tr('home.heroTitle')}
                <br />
                <span className="bg-gradient-to-r from-brand via-brand-deep to-perf bg-clip-text text-transparent">
                  {tr('home.heroTitle2')}
                </span>
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft animate-fade-up lg:mx-0" style={{ animationDelay: '80ms' }}>
                {tr('home.heroSubtitle')}
              </p>
              {/* relative z-20: the entrance animations create stacking contexts on
                  the sibling stat pills + map; without an explicit z-index here the
                  search dropdown would paint UNDERNEATH them. */}
              <div className="relative z-20 mx-auto mt-7 max-w-xl animate-fade-up lg:mx-0" style={{ animationDelay: '160ms' }}>
                <SearchBox variant="hero" />
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm lg:justify-start">
                  <span className="text-ink-faint">{tr('search.tryLabel')}:</span>
                  {examples.map((ex) => (
                    <Link
                      key={ex}
                      href={`/search?q=${encodeURIComponent(ex)}`}
                      className="pressable rounded-full border border-brand/20 bg-white/90 px-3 py-1 font-medium text-brand backdrop-blur hover:bg-brand-soft"
                    >
                      {ex}
                    </Link>
                  ))}
                </div>
              </div>

              {/* Live counters */}
              <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-up" style={{ animationDelay: '240ms' }}>
                <StatPill value={<CountUp value={stats.politicians} />} label={tr('home.statLeaders')} tone="brand" />
                <StatPill value={<CountUp value={stats.constituencies} />} label={tr('home.statAreas')} tone="perf" />
                <StatPill value={<CountUp value={stats.districts} />} label={tr('home.statDistricts')} tone="rating" />
                <StatPill value={<CountUp value={stats.states} />} label={tr('home.statStates')} tone="ink" />
              </div>
            </div>

            <div className="animate-map-in" style={{ animationDelay: '150ms' }}>
              <GeoMap shapes={shapes} w={520} h={560} ariaLabel={tr('home.mapAria')} maxWidthClass="max-w-md" />
              <p className="mt-2 text-center text-sm text-ink-faint">
                <Icon name="pin" size={14} className="mr-1 inline-block" />
                {tr('home.mapHint')}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-content px-4 py-8">
        {/* Org chart of India — how power flows */}
        <Reveal as="section" className="mb-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
                <Icon name="network" size={22} />
              </span>
              <div>
                <h2 className="text-xl font-bold text-ink">{tr('hierarchy.title')}</h2>
                <p className="text-sm text-ink-faint">{tr('hierarchy.help')}</p>
              </div>
            </div>
            <Link href="/hierarchy" className="pressable inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-brand-deep">
              {tr('hierarchy.fullChart')} <Icon name="arrow" size={15} />
            </Link>
          </div>
          <HierarchyLadder />
        </Reveal>

        {/* Government of India — the top of the ladder */}
        <Reveal as="section" className="mb-8">
          <SectionCard
            title={tr('central.title')}
            subtitle={tr('central.subtitle')}
            icon="parliament"
            aside={
              <Link href="/india" className="shrink-0 whitespace-nowrap text-sm font-semibold text-brand hover:underline">
                {tr('central.seeAll')} →
              </Link>
            }
          >
            {pm ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
                <Link href={`/person/${pm.politicianId || pm.id}`} className="pressable flex gap-3 rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-soft/70 to-white p-4 transition hover:shadow-lift">
                  <Avatar name={pm.name} src={pm.photo_url} size={64} />
                  <div className="min-w-0">
                    <Chip tone="brand" icon="parliament">{tr('central.pm')}</Chip>
                    <p className="mt-1.5 text-xl font-bold text-ink">{pm.name}</p>
                    <div className="mt-1"><PartyChip party={pm.party} /></div>
                  </div>
                </Link>
                <div>
                  <Eyebrow>{tr('central.cabinet')}</Eyebrow>
                  <ul className="mt-2 divide-y divide-line/70 overflow-hidden rounded-xl border border-line/70 bg-white/80">
                    {topCabinet.map((m) => (
                      <li key={m.id}>
                        <Link href={`/person/${m.politicianId || m.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-brand-soft/50">
                          <span className="font-medium text-ink">{m.name}</span>
                          <span className="truncate text-right text-xs text-ink-faint">{m.portfolios[0]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <Link href="/india" className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-paper-soft px-4 py-5 text-sm text-ink-soft hover:border-brand">
                <span className="flex items-center gap-2"><Icon name="parliament" size={18} className="text-brand" /> {tr('central.comingSoon')}</span>
                <span className="font-semibold text-brand">{tr('central.seeAll')} →</span>
              </Link>
            )}
          </SectionCard>
        </Reveal>

        {/* Finder CTA — guided "who's responsible for what" */}
        <Reveal className="mb-8">
          <Link
            href="/who"
            className="pressable flex items-center gap-4 rounded-3xl border border-accent/30 bg-gradient-to-r from-accent-soft via-white/60 to-brand-soft p-5 shadow-glass transition hover:shadow-lift"
          >
            <span className="inline-grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent text-white shadow-soft">
              <Icon name="megaphone" size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-ink">{tr('finder.title')}</h2>
              <p className="text-sm text-ink-soft">{tr('finder.subtitle')}</p>
            </div>
            <Icon name="arrow" size={22} className="hidden shrink-0 text-accent-ink sm:block" />
          </Link>
        </Reveal>

        {/* State drill-down + top leaders */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.15fr]">
          <Reveal>
            <SectionCard title={tr('home.exploreTitle')} subtitle={tr('home.exploreHelp')} icon="map">
              <Eyebrow>{tr('home.statesWithData')}</Eyebrow>
              <ul className="mt-2 flex flex-wrap gap-2">
                {states.map((s) => (
                  <li key={s.stateCode}>
                    <Link
                      href={`/state/${s.stateCode}`}
                      className="pressable inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3.5 py-1.5 text-sm font-semibold text-brand-ink hover:bg-brand hover:text-white"
                    >
                      {s.state}
                      <span className="rounded-full bg-white/90 px-1.5 text-xs tabular-nums text-brand-ink">{s.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </Reveal>

          <Reveal delay={90}>
            <SectionCard title={tr('home.topTitle')} subtitle={tr('home.topHelp')} icon="star" aside={<LastUpdated date={meta.lastUpdated} />}>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2.5 rounded-xl bg-perf-soft px-3 py-2">
                  <ScoreRing value={78} size={44} animate={false} />
                  <div className="text-xs">
                    <p className="font-bold text-perf-ink">{tr('home.scoresTitle')}</p>
                    <p className="text-ink-soft">{tr('home.perfHelp')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl bg-rating-soft px-3 py-2">
                  <Stars value={4} size={16} />
                  <div className="text-xs">
                    <p className="font-bold text-rating-ink">{tr('profile.scoreRating')}</p>
                    <p className="text-ink-soft">{tr('home.ratingHelp')}</p>
                  </div>
                </div>
              </div>
              {ranking && ranking.entries.length > 0 ? (
                <RankingList entries={ranking.entries} />
              ) : (
                <p className="text-sm text-ink-faint">{tr('search.noResults')}</p>
              )}
            </SectionCard>
          </Reveal>
        </div>

        {/* Who does what */}
        <Reveal as="section" className="mt-8">
          <div className="mb-4 flex items-center gap-3">
            <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <Icon name="info" size={22} />
            </span>
            <div>
              <h2 className="text-xl font-bold text-ink">{tr('home.tiersTitle')}</h2>
              <p className="text-sm text-ink-faint">{tr('home.tiersHelp')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {tiers.map(({ role, icon, tint }, i) => (
              <Reveal key={role} delay={i * 80}>
                <Link
                  href="/accountability"
                  className="group pressable block h-full rounded-3xl p-5 glass transition hover:shadow-lift"
                >
                  <span className={`inline-grid h-12 w-12 place-items-center rounded-2xl ${tint}`}>
                    <Icon name={icon} size={26} />
                  </span>
                  <h3 className="mt-3 font-bold text-ink">{tr(`accountability.roles.${role}.title`)}</h3>
                  <p className="mt-1 text-sm text-ink-soft">{tr(`accountability.roles.${role}.oneLine`)}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                    {tr('common.readMore')} <Icon name="arrow" size={15} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </Reveal>

        <div className="mt-8">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
