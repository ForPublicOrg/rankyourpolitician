import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import RankingsExplorer from '@/components/RankingsExplorer';
import { PageHero } from '@/components/ui';

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return {
    title: t(dict, 'ranking.fullTitle'),
    description: t(dict, 'ranking.fullSubtitle'),
  };
}

export default async function RankingsPage() {
  const { dict } = await getI18n();
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  return (
    <>
      <PageHero title={tr('ranking.fullTitle')} subtitle={tr('ranking.fullSubtitle')} />
      <div className="mx-auto max-w-content px-4 py-6">
        {/* useSearchParams (deep-linked filters) requires a Suspense boundary */}
        <Suspense fallback={<div className="skeleton h-40 w-full" />}>
          <RankingsExplorer />
        </Suspense>
      </div>
    </>
  );
}
