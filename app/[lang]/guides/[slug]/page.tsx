import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { LOCALE_CODES } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import Breadcrumbs from '@/components/Breadcrumbs';
import { PageHero, Chip } from '@/components/ui';
import { Reveal } from '@/components/motion';
import Icon from '@/components/Icon';
import AdSlot from '@/components/AdSlot';
import { GUIDE_BY_SLUG, GUIDE_SLUGS, GUIDES } from '@/lib/guides';

// Prose from the message files - changes only on deploy (see README "How data
// flows"), so a weekly self-heal is plenty.
export const revalidate = 604800;

// 4 guides x every locale is 92 cheap prerenders - unlike the person pages,
// there is no scale problem here, so prebuild them all.
export function generateStaticParams() {
  return LOCALE_CODES.flatMap((lang) => GUIDE_SLUGS.map((slug) => ({ lang, slug })));
}

type Section = { heading: string; body?: string[]; steps?: string[] };
type Faq = { q: string; a: string };
type GuideContent = {
  title: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  disclaimer?: string;
  intro: string;
  sections: Section[];
  faq: Faq[];
};

function readGuide(dict: unknown, slug: string): GuideContent | null {
  const v = ['guides', 'items', slug].reduce<any>((o, k) => (o == null ? undefined : o[k]), dict);
  return v && typeof v === 'object' ? (v as GuideContent) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const { dict } = await getI18n(lang);
  const g = readGuide(dict, slug);
  if (!g) return { title: 'Not found' };
  return {
    title: g.metaTitle,
    description: g.metaDescription,
    alternates: { canonical: `/guides/${slug}` },
    openGraph: { title: g.metaTitle, description: g.metaDescription, url: `/guides/${slug}`, type: 'article' },
    twitter: { card: 'summary', title: g.metaTitle, description: g.metaDescription },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  const def = GUIDE_BY_SLUG.get(slug);
  if (!def) notFound();
  const { dict, locale } = await getI18n(lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);
  const g = readGuide(dict, slug);
  if (!g) notFound();

  const sections = Array.isArray(g.sections) ? g.sections : [];
  const faq = Array.isArray(g.faq) ? g.faq : [];
  const others = GUIDES.filter((o) => o.slug !== slug);

  return (
    <>
      <PageHero
        crumbs={
          <Breadcrumbs
            items={[
              { label: tr('levels.national'), href: '/' },
              { label: tr('guides.hubTitle'), href: '/guides' },
              { label: g.title },
            ]}
          />
        }
        title={g.title}
        subtitle={g.subtitle}
        chips={
          <>
            <Chip tone="brand" icon={def.icon}>{tr('guides.hubEyebrow')}</Chip>
            <Chip tone="neutral" icon="shield">{tr('forLeaders.nonpartisanTag')}</Chip>
          </>
        }
      />

      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Lead paragraph */}
        <Reveal>
          <p className="text-lg leading-relaxed text-ink-soft">{g.intro}</p>
        </Reveal>

        {/* Civic-education, not legal advice (only guides that carry one). */}
        {g.disclaimer && (
          <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-line bg-paper-soft px-4 py-3 text-sm text-ink-soft">
            <Icon name="info" size={18} className="mt-0.5 shrink-0 text-brand" />
            <p>{g.disclaimer}</p>
          </div>
        )}

        {/* Jump list */}
        {sections.length > 2 && (
          <nav aria-label={tr('guides.onThisPage')} className="mt-6">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">{tr('guides.onThisPage')}</p>
            <div className="flex flex-wrap gap-2">
              {sections.map((s, i) => (
                <a
                  key={i}
                  href={`#s${i}`}
                  className="pressable rounded-full border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink-soft hover:border-brand/40 hover:text-brand"
                >
                  {s.heading}
                </a>
              ))}
            </div>
          </nav>
        )}

        {/* Sections */}
        <div className="mt-8 space-y-6">
          {sections.map((s, i) => (
            <Reveal key={i} as="section">
              <section id={`s${i}`} aria-labelledby={`s${i}-h`} className="scroll-mt-24">
                <div className="flex items-start gap-3.5">
                  <span className={`inline-grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${def.accent}`}>
                    <Icon name={def.sectionIcons[i] ?? 'check'} size={22} />
                  </span>
                  <h2 id={`s${i}-h`} className="mt-1 font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
                    {s.heading}
                  </h2>
                </div>
                <div className="mt-3 space-y-3 pl-0 sm:pl-[3.6rem]">
                  {(s.body ?? []).map((para, j) => (
                    <p key={j} className="leading-relaxed text-ink-soft">{para}</p>
                  ))}
                  {Array.isArray(s.steps) && s.steps.length > 0 && (
                    <ol className="mt-1 space-y-2.5">
                      {s.steps.map((step, j) => (
                        <li key={j} className="flex gap-3 rounded-2xl border border-line bg-white px-4 py-3">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-paper">
                            {j + 1}
                          </span>
                          <span className="text-sm leading-relaxed text-ink-soft">{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>
            </Reveal>
          ))}
        </div>

        {/* FAQ */}
        {faq.length > 0 && (
          <Reveal className="mt-10">
            <h2 className="font-display text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{tr('guides.faqTitle')}</h2>
            <div className="mt-4 space-y-2.5">
              {faq.map((f, i) => (
                <details key={i} className="group rounded-2xl border border-line bg-white px-4 py-3">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-ink">
                    {f.q}
                    <Icon name="chevron" size={16} className="shrink-0 text-ink-faint transition group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        )}

        {/* Sources - facts, kept in code so a translation can never corrupt a URL. */}
        <div className="mt-9 rounded-2xl border border-line bg-paper-soft p-4 sm:p-5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
            <Icon name="link" size={14} /> {tr('guides.sourcesTitle')}
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {def.sources.map((src) => (
              <li key={src.url} className="flex flex-wrap items-center gap-x-2 text-sm">
                <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand hover:underline">
                  <Icon name="external" size={13} /> {src.label}
                </a>
                <span className="text-xs text-ink-faint">· {formatDate(src.retrieved, locale)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* More guides - internal linking to the rest of the library. */}
        {others.length > 0 && (
          <div className="mt-9">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">{tr('guides.moreGuides')}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {others.map((o) => {
                const oc = readGuide(dict, o.slug);
                return (
                  <Link
                    key={o.slug}
                    href={`/guides/${o.slug}`}
                    className="pressable group flex items-center gap-3 rounded-2xl border border-line bg-white p-4 hover:border-brand/40 hover:shadow-lift"
                  >
                    <span className={`inline-grid h-10 w-10 shrink-0 place-items-center rounded-xl ${o.accent}`}>
                      <Icon name={o.icon} size={20} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{oc?.title ?? o.slug}</span>
                    <Icon name="arrow" size={16} className="shrink-0 text-brand transition group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-8">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
