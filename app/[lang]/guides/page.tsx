import Link from 'next/link';
import type { Metadata } from 'next';
import { getI18n, type LangParams } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import Breadcrumbs from '@/components/Breadcrumbs';
import { PageHero, Chip } from '@/components/ui';
import { Reveal } from '@/components/motion';
import Icon from '@/components/Icon';
import AdSlot from '@/components/AdSlot';
import { GUIDES } from '@/lib/guides';

export const revalidate = 604800;
export { allLocaleStaticParams as generateStaticParams } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<LangParams> }): Promise<Metadata> {
  const { dict } = await getI18n((await params).lang);
  return {
    title: t(dict, 'guides.hubTitle'),
    description: t(dict, 'guides.hubSubtitle'),
    alternates: { canonical: '/guides' },
    openGraph: { title: t(dict, 'guides.hubTitle'), description: t(dict, 'guides.hubSubtitle') },
  };
}

export default async function GuidesHubPage({ params }: { params: Promise<LangParams> }) {
  const { dict } = await getI18n((await params).lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  return (
    <>
      <PageHero
        crumbs={<Breadcrumbs items={[{ label: tr('levels.national'), href: '/' }, { label: tr('guides.hubTitle') }]} />}
        title={tr('guides.hubTitle')}
        subtitle={tr('guides.hubSubtitle')}
        chips={
          <>
            <Chip tone="brand" icon="cap">{tr('guides.hubEyebrow')}</Chip>
            <Chip tone="neutral" icon="shield">{tr('forLeaders.nonpartisanTag')}</Chip>
          </>
        }
      />

      <div className="mx-auto max-w-3xl px-4 py-8">
        <Reveal>
          <p className="text-lg leading-relaxed text-ink-soft">{tr('guides.hubIntro')}</p>
        </Reveal>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {GUIDES.map((g, i) => (
            <Reveal key={g.slug} delay={i * 70} as="div">
              <Link
                href={`/guides/${g.slug}`}
                className="pressable group flex h-full flex-col rounded-3xl border border-line bg-white p-5 hover:border-brand/40 hover:shadow-lift"
              >
                <span className={`inline-grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${g.accent}`}>
                  <Icon name={g.icon} size={26} />
                </span>
                <h2 className="mt-4 font-display text-lg font-bold tracking-tight text-ink">
                  {t(dict, `guides.items.${g.slug}.title`)}
                </h2>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-soft">
                  {t(dict, `guides.items.${g.slug}.hubSummary`)}
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                  {tr('guides.readGuide')} <Icon name="arrow" size={15} className="transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        <div className="mt-9">
          <AdSlot />
        </div>
      </div>
    </>
  );
}
