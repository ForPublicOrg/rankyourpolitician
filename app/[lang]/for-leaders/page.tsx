import type { Metadata } from 'next';
import { getI18n, type LangParams } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import Breadcrumbs from '@/components/Breadcrumbs';
import { PageHero, Chip } from '@/components/ui';
import { Reveal } from '@/components/motion';
import Icon, { type IconName } from '@/components/Icon';
import AdSlot from '@/components/AdSlot';

// Weekly self-heal only - the wisdom is fixed prose from the seed, and changes
// only on deploy (see README "How data flows").
export const revalidate = 604800;
export { allLocaleStaticParams as generateStaticParams } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<LangParams> }): Promise<Metadata> {
  const { dict } = await getI18n((await params).lang);
  return {
    title: t(dict, 'forLeaders.title'),
    description: t(dict, 'forLeaders.metaDescription'),
    alternates: { canonical: '/for-leaders' },
    openGraph: {
      title: t(dict, 'forLeaders.metaTitle'),
      description: t(dict, 'forLeaders.metaDescription'),
    },
  };
}

// Presentation (icon) + the CITATION for each lesson live in code, by index:
// these are facts, not translatable copy. The words (heading, quote, source
// label, explanation) are localised under forLeaders.principles[]. Every quote
// was checked against the cited source before publishing (no citation, no claim).
// `original` is the source-language text of a scripture verse, shown verbatim and
// never machine-altered - so it stays LTR even on RTL locales.
//
// The last lesson has no source_url on purpose: it is not a quotation from
// anywhere, it is written for this site by the person who built it. Rather than
// fake a citation for it, the card says so in place of the source link - the
// same "no citation, no claim" rule, answered by dropping the claim to be a quote.
type Lesson = { icon: IconName; original?: string; source_url?: string; retrieved?: string };
const LESSONS: Lesson[] = [
  {
    icon: 'star',
    original: 'यद्यदाचरति श्रेष्ठस्तत्तदेवेतरो जनः।\nस यत्प्रमाणं कुरुते लोकस्तदनुवर्तते॥',
    source_url: 'https://www.holy-bhagavad-gita.org/chapter/3/verse/21',
    retrieved: '2026-07-20',
  },
  {
    icon: 'people',
    source_url: 'https://www.wisdomlib.org/hinduism/book/kautilya-arthashastra/d/doc365597.html',
    retrieved: '2026-07-20',
  },
  {
    icon: 'scales',
    original: 'வேலன்று வென்றி தருவது மன்னவன் கோலதூஉங் கோடா தெனின்.',
    source_url: 'https://www.thirukkural.net/en/kural/kural-0546.html',
    retrieved: '2026-07-20',
  },
  {
    icon: 'briefcase',
    original: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि॥',
    source_url: 'https://www.holy-bhagavad-gita.org/chapter/2/verse/47',
    retrieved: '2026-07-20',
  },
  {
    icon: 'shield',
    source_url: 'https://www.wisdomlib.org/hinduism/book/kautilya-arthashastra/d/doc366124.html',
    retrieved: '2026-07-20',
  },
  {
    icon: 'compass',
    source_url: 'https://www.mkgandhi.org/thiswasbapu/70gandhitalisman.php',
    retrieved: '2026-07-20',
  },
  {
    icon: 'globe',
    source_url: 'https://www.accesstoinsight.org/lib/authors/dhammika/wheel386.html',
    retrieved: '2026-07-20',
  },
  { icon: 'heart' },
];

type PItem = { heading: string; quote: string; source: string; explain: string };

export default async function ForLeadersPage({ params }: { params: Promise<LangParams> }) {
  const { dict, locale } = await getI18n((await params).lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);
  const principles = (() => {
    const v = ['forLeaders', 'principles'].reduce<any>((o, k) => (o == null ? undefined : o[k]), dict);
    return Array.isArray(v) ? (v as PItem[]) : [];
  })();

  return (
    <>
      <PageHero
        crumbs={<Breadcrumbs items={[{ label: tr('levels.national'), href: '/' }, { label: tr('nav.forLeaders') }]} />}
        title={tr('forLeaders.title')}
        subtitle={tr('forLeaders.subtitle')}
        chips={
          <>
            <Chip tone="brand" icon="sparkle">{tr('forLeaders.eyebrow')}</Chip>
            <Chip tone="neutral" icon="shield">{tr('forLeaders.nonpartisanTag')}</Chip>
          </>
        }
      />

      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* A short, direct word to the reader. */}
        <Reveal>
          <div className="glass rounded-3xl p-5 sm:p-6">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-brand">
              <Icon name="people" size={15} /> {tr('forLeaders.addressTitle')}
            </p>
            <p className="mt-2 leading-relaxed text-ink-soft">{tr('forLeaders.address')}</p>
          </div>
        </Reveal>

        <h2 className="mt-9 font-display text-2xl font-extrabold tracking-tight text-ink">
          {tr('forLeaders.principlesTitle')}
        </h2>

        <div className="mt-5 space-y-5">
          {principles.map((it, i) => {
            const L = LESSONS[i];
            if (!L) return null;
            return (
              <Reveal key={i} as="div">
                <article className="glass block rounded-3xl p-5 sm:p-6">
                  <div className="flex items-start gap-3.5">
                    <span className="relative inline-grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
                      <Icon name={L.icon} size={24} />
                      <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-paper">
                        {i + 1}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                        {tr('forLeaders.lessonWord')} {i + 1}
                      </p>
                      <h3 className="mt-0.5 font-display text-xl font-bold tracking-tight text-ink">{it.heading}</h3>
                    </div>
                  </div>

                  {/* The quote itself, its original-language line (if scripture), and the citation. */}
                  <blockquote className="mt-4 rounded-2xl border-l-4 border-brand/40 bg-paper-soft/70 p-4">
                    <p className="text-lg font-medium leading-relaxed text-ink">{it.quote}</p>
                    {L.original && (
                      <p dir="ltr" lang={L.icon === 'scales' ? 'ta' : 'sa'} className="mt-2.5 whitespace-pre-line text-sm italic leading-relaxed text-ink-faint">
                        {L.original}
                      </p>
                    )}
                    <footer className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <cite className="text-sm font-semibold not-italic text-brand-ink">- {it.source}</cite>
                      {L.source_url ? (
                        <>
                          <a
                            href={L.source_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                          >
                            <Icon name="link" size={12} /> {tr('forLeaders.sourceLabel')}
                          </a>
                          {L.retrieved && <span className="text-xs text-ink-faint">· {formatDate(L.retrieved, locale)}</span>}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
                          <Icon name="info" size={12} /> {tr('forLeaders.ownWordsLabel')}
                        </span>
                      )}
                    </footer>
                  </blockquote>

                  <p className="mt-4 leading-relaxed text-ink-soft">{it.explain}</p>
                </article>
              </Reveal>
            );
          })}
        </div>

        {/* Closing */}
        <Reveal className="mt-9">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-deep p-6 text-white shadow-glow sm:p-7">
            <span className="tricolor-line mb-3 block w-12" aria-hidden="true" />
            <h2 className="font-display text-xl font-extrabold sm:text-2xl">{tr('forLeaders.closingTitle')}</h2>
            <p className="mt-2 max-w-2xl leading-relaxed text-white/85">{tr('forLeaders.closingBody')}</p>
          </div>
        </Reveal>

        {/* How these are sourced - answers the "is this real?" question up front. */}
        <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-line bg-paper-soft px-4 py-3 text-sm text-ink-soft">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-brand" />
          <p>{tr('forLeaders.sourcesNote')}</p>
        </div>

        <div className="mt-8">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
