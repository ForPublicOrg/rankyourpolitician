import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n, type LangParams } from '@/lib/i18n/server';
import { t, tArr } from '@/lib/i18n';
import Breadcrumbs from '@/components/Breadcrumbs';
import { PageHero, Chip } from '@/components/ui';
import { Reveal } from '@/components/motion';
import Icon, { type IconName } from '@/components/Icon';
import AdSlot from '@/components/AdSlot';

// Weekly self-heal only. This is prose from the seed, not live data - it
// changes on deploy, so a tighter window would just add billed ISR writes
// (see README "How data flows").
export const revalidate = 604800;
export { allLocaleStaticParams as generateStaticParams } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<LangParams> }): Promise<Metadata> {
  const { dict } = await getI18n((await params).lang);
  return {
    title: t(dict, 'rights.title'),
    description: t(dict, 'rights.metaDescription'),
    alternates: { canonical: '/rights' },
    openGraph: {
      title: t(dict, 'rights.metaTitle'),
      description: t(dict, 'rights.metaDescription'),
    },
  };
}

// Order + presentation for the six fundamental rights. Content (title, summary,
// article numbers, examples) is fully localised under rights.fundamental.items.
const RIGHTS: { id: string; icon: IconName; tint: string }[] = [
  { id: 'equality', icon: 'people', tint: 'bg-brand-soft text-brand' },
  { id: 'freedom', icon: 'megaphone', tint: 'bg-perf-soft text-perf' },
  { id: 'exploitation', icon: 'shield', tint: 'bg-rating-soft text-rating-ink' },
  { id: 'religion', icon: 'compass', tint: 'bg-accent-soft text-accent-ink' },
  { id: 'cultural', icon: 'cap', tint: 'bg-brand-soft text-brand' },
  { id: 'remedies', icon: 'scales', tint: 'bg-perf-soft text-perf' },
];

const VALUES = ['justice', 'liberty', 'equality', 'fraternity'] as const;
const WRITS = ['habeas', 'mandamus', 'prohibition', 'certiorari', 'quo'] as const;
const FACTS = ['adopted', 'inforce', 'original', 'schedules'] as const;

// Table-of-contents entries → in-page anchor ids.
const TOC: { key: string; id: string }[] = [
  { key: 'preamble', id: 'preamble' },
  { key: 'fundamental', id: 'rights' },
  { key: 'keyArticles', id: 'life' },
  { key: 'remedies', id: 'remedies' },
  { key: 'duties', id: 'duties' },
  { key: 'directive', id: 'directive' },
  { key: 'structure', id: 'structure' },
];

export default async function RightsPage({ params }: { params: Promise<LangParams> }) {
  const { dict } = await getI18n((await params).lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  return (
    <>
      <PageHero
        crumbs={<Breadcrumbs items={[{ label: tr('levels.national'), href: '/' }, { label: tr('nav.rights') }]} />}
        title={tr('rights.title')}
        subtitle={tr('rights.subtitle')}
        chips={
          <>
            <Chip tone="brand" icon="scales">{tr('rights.chips.part3')}</Chip>
            <Chip tone="perf" icon="sparkle">{tr('rights.chips.plain')}</Chip>
            <Chip tone="neutral" icon="people">{tr('rights.chips.everyone')}</Chip>
          </>
        }
      />

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Disclaimer - civic education, not legal advice */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-paper-soft px-4 py-3 text-sm text-ink-soft">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-brand" />
          <p>{tr('rights.disclaimer')}</p>
        </div>

        {/* On this page - quick jump */}
        <nav aria-label={tr('rights.tocTitle')} className="mt-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">{tr('rights.tocTitle')}</p>
          <div className="flex flex-wrap gap-2">
            {TOC.map(({ key, id }) => (
              <a
                key={id}
                href={`#${id}`}
                className="pressable rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink-soft hover:border-brand/40 hover:text-brand"
              >
                {tr(`rights.toc.${key}`)}
              </a>
            ))}
          </div>
        </nav>

        {/* 1 - The Preamble */}
        <Reveal className="mt-9">
          <section id="preamble" aria-labelledby="preamble-h" className="scroll-mt-24">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-deep p-6 text-white shadow-glow sm:p-7">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">{tr('rights.preamble.eyebrow')}</p>
              <h2 id="preamble-h" className="mt-1 font-display text-2xl font-extrabold">{tr('rights.preamble.title')}</h2>
              <p className="mt-2 max-w-2xl text-sm text-white/85">{tr('rights.preamble.intro')}</p>
              <blockquote className="mt-4 border-l-2 border-white/40 pl-4 text-lg font-semibold italic text-white/95">
                {tr('rights.preamble.quote')}
              </blockquote>
              <p className="mt-4 text-sm font-semibold text-white/90">{tr('rights.preamble.identity')}</p>
              <p className="mt-1 text-xs text-white/70">{tr('rights.preamble.identityNote')}</p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {VALUES.map((v) => (
                  <div key={v} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
                    <p className="font-bold text-white">{tr(`rights.preamble.values.${v}.title`)}</p>
                    <p className="mt-0.5 text-sm text-white/80">{tr(`rights.preamble.values.${v}.desc`)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </Reveal>

        {/* 2 - The six fundamental rights */}
        <section id="rights" aria-labelledby="rights-h" className="mt-12 scroll-mt-24">
          <Reveal>
            <SectionHead
              eyebrow={tr('rights.fundamental.eyebrow')}
              title={tr('rights.fundamental.title')}
              intro={tr('rights.fundamental.intro')}
              id="rights-h"
            />
          </Reveal>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {RIGHTS.map(({ id, icon, tint }, i) => (
              <Reveal key={id} delay={(i % 2) * 70} as="div">
                <article className="glass flex h-full flex-col rounded-3xl p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <span className={`relative inline-grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tint}`}>
                      <Icon name={icon} size={26} />
                      <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-paper">
                        {i + 1}
                      </span>
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold leading-tight text-ink">{tr(`rights.fundamental.items.${id}.title`)}</h3>
                      <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-paper-sink px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                        <Icon name="law" size={12} /> {tr(`rights.fundamental.items.${id}.articles`)}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 font-semibold text-ink">{tr(`rights.fundamental.items.${id}.summary`)}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{tr(`rights.fundamental.items.${id}.means`)}</p>

                  <div className="mt-4 rounded-2xl bg-paper-soft p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{tr('rights.fundamental.meansLabel')}</p>
                    <ul className="mt-2 space-y-2">
                      {tArr(dict, `rights.fundamental.items.${id}.examples`).map((ex, j) => (
                        <li key={j} className="flex gap-2 text-sm text-ink-soft">
                          <Icon name="check" size={15} className="mt-0.5 shrink-0 text-perf" />
                          <span>{ex}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* 3 - Life, liberty & education (the most-used articles) */}
        <section id="life" aria-labelledby="life-h" className="mt-12 scroll-mt-24">
          <Reveal>
            <SectionHead
              eyebrow={tr('rights.keyArticles.eyebrow')}
              title={tr('rights.keyArticles.title')}
              intro={tr('rights.keyArticles.intro')}
              id="life-h"
            />
          </Reveal>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Reveal>
              <HighlightCard
                badge={tr('rights.keyArticles.life.badge')}
                title={tr('rights.keyArticles.life.title')}
                desc={tr('rights.keyArticles.life.desc')}
                icon="shield"
                tone="brand"
              />
            </Reveal>
            <Reveal delay={70}>
              <HighlightCard
                badge={tr('rights.keyArticles.education.badge')}
                title={tr('rights.keyArticles.education.title')}
                desc={tr('rights.keyArticles.education.desc')}
                icon="cap"
                tone="perf"
              />
            </Reveal>
          </div>
        </section>

        {/* 4 - Enforcing your rights + the five writs */}
        <section id="remedies" aria-labelledby="remedies-h" className="mt-12 scroll-mt-24">
          <Reveal>
            <SectionHead
              eyebrow={tr('rights.remedies.eyebrow')}
              title={tr('rights.remedies.title')}
              intro={tr('rights.remedies.intro')}
              id="remedies-h"
            />
          </Reveal>

          <Reveal className="mt-6">
            <div className="glass rounded-3xl p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-bold text-ink">
                <Icon name="scales" size={18} className="text-brand" /> {tr('rights.remedies.writsTitle')}
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {WRITS.map((w) => (
                  <div key={w} className="rounded-2xl bg-paper-soft p-4">
                    <p className="font-bold text-ink">{tr(`rights.remedies.writs.${w}.name`)}</p>
                    <p className="mt-0.5 text-sm text-ink-soft">{tr(`rights.remedies.writs.${w}.desc`)}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal className="mt-4">
            <div className="rounded-3xl border border-line bg-white p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-bold text-ink">
                <Icon name="megaphone" size={18} className="text-accent" /> {tr('rights.remedies.practicalTitle')}
              </h3>
              <ul className="mt-3 space-y-2">
                {tArr(dict, 'rights.remedies.practical').map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-soft">
                    <Icon name="arrow" size={15} className="mt-0.5 shrink-0 text-brand" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* 5 - Fundamental duties */}
        <section id="duties" aria-labelledby="duties-h" className="mt-12 scroll-mt-24">
          <Reveal>
            <SectionHead
              eyebrow={tr('rights.duties.eyebrow')}
              title={tr('rights.duties.title')}
              intro={tr('rights.duties.intro')}
              id="duties-h"
            />
          </Reveal>
          <Reveal className="mt-6">
            <div className="glass rounded-3xl p-5 sm:p-6">
              <ol className="grid gap-3 sm:grid-cols-2">
                {tArr(dict, 'rights.duties.items').map((d, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                      {i + 1}
                    </span>
                    <span className="text-sm text-ink-soft">{d}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </section>

        {/* 6 - Directive principles */}
        <section id="directive" aria-labelledby="directive-h" className="mt-12 scroll-mt-24">
          <Reveal>
            <SectionHead
              eyebrow={tr('rights.directive.eyebrow')}
              title={tr('rights.directive.title')}
              intro={tr('rights.directive.intro')}
              id="directive-h"
            />
          </Reveal>
          <Reveal className="mt-6">
            <ul className="grid gap-3 sm:grid-cols-2">
              {tArr(dict, 'rights.directive.items').map((d, i) => (
                <li key={i} className="flex gap-2.5 rounded-2xl border border-line bg-white p-4 text-sm text-ink-soft">
                  <Icon name="flag" size={16} className="mt-0.5 shrink-0 text-perf" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* 7 - The whole Constitution (structure) */}
        <section id="structure" aria-labelledby="structure-h" className="mt-12 scroll-mt-24">
          <Reveal>
            <SectionHead
              eyebrow={tr('rights.structure.eyebrow')}
              title={tr('rights.structure.title')}
              intro={tr('rights.structure.intro')}
              id="structure-h"
            />
          </Reveal>

          <Reveal className="mt-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FACTS.map((f) => (
                <div key={f} className="glass flex flex-col items-center rounded-2xl px-3 py-4 text-center">
                  <span className="font-display text-xl font-extrabold tracking-tight text-brand sm:text-2xl">
                    {tr(`rights.structure.facts.${f}.value`)}
                  </span>
                  <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {tr(`rights.structure.facts.${f}.label`)}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-3xl border border-line bg-white p-5 sm:p-6">
                <h3 className="flex items-center gap-2 font-bold text-ink">
                  <Icon name="layers" size={18} className="text-brand" /> {tr('rights.structure.partsTitle')}
                </h3>
                <p className="mt-1 text-sm text-ink-faint">{tr('rights.structure.partsIntro')}</p>
                <ul className="mt-3 space-y-2">
                  {tArr(dict, 'rights.structure.parts').map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-soft">
                      <Icon name="chevron" size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={70}>
              <div className="h-full rounded-3xl border border-line bg-white p-5 sm:p-6">
                <h3 className="flex items-center gap-2 font-bold text-ink">
                  <Icon name="grid" size={18} className="text-perf" /> {tr('rights.structure.schedulesTitle')}
                </h3>
                <p className="mt-1 text-sm text-ink-faint">{tr('rights.structure.schedulesIntro')}</p>
                <ul className="mt-3 space-y-2">
                  {tArr(dict, 'rights.structure.schedules').map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-soft">
                      <Icon name="chevron" size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>

          <Reveal className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-2xl bg-brand-soft p-4">
                <Icon name="clock" size={18} className="mt-0.5 shrink-0 text-brand" />
                <div>
                  <p className="font-bold text-ink">{tr('rights.structure.amendTitle')}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{tr('rights.structure.amendDesc')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl bg-paper-sink p-4">
                <Icon name="wallet" size={18} className="mt-0.5 shrink-0 text-ink-soft" />
                <p className="text-sm text-ink-soft">{tr('rights.structure.propertyNote')}</p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* Closing - route to accountability + the finder */}
        <Reveal className="mt-12">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-deep p-6 text-white shadow-glow sm:p-7">
            <h2 className="font-display text-xl font-extrabold">{tr('rights.closing.title')}</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-white/85">{tr('rights.closing.desc')}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/accountability"
                className="pressable inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-brand shadow-soft hover:bg-white/90"
              >
                <Icon name="megaphone" size={15} /> {tr('rights.closing.whoDoes')}
              </Link>
              <Link
                href="/who"
                className="pressable inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/25 hover:bg-white/25"
              >
                <Icon name="pin" size={15} /> {tr('rights.closing.getHelp')}
              </Link>
            </div>
          </div>
        </Reveal>

        <p className="mt-6 flex items-start gap-2 text-xs text-ink-faint">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>{tr('rights.closing.sourceNote')}</span>
        </p>

        <div className="mt-8">
          <AdSlot />
        </div>
      </div>
    </>
  );
}

/** Section heading block: eyebrow + title + intro, shared by every section. */
function SectionHead({ eyebrow, title, intro, id }: { eyebrow: string; title: string; intro: string; id: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{eyebrow}</p>
      <h2 id={id} className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-ink-soft">{intro}</p>
    </div>
  );
}

/** Coloured highlight card for the two most-used articles (21 and 21A). */
function HighlightCard({
  badge,
  title,
  desc,
  icon,
  tone,
}: {
  badge: string;
  title: string;
  desc: string;
  icon: IconName;
  tone: 'brand' | 'perf';
}) {
  const tint = tone === 'brand' ? 'bg-brand-soft text-brand' : 'bg-perf-soft text-perf';
  return (
    <div className="glass flex h-full flex-col rounded-3xl p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className={`inline-grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tint}`}>
          <Icon name={icon} size={24} />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{badge}</p>
          <h3 className="text-lg font-bold leading-tight text-ink">{title}</h3>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{desc}</p>
    </div>
  );
}
