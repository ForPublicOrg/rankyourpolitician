import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStateByCode } from '@/lib/data';
import { getI18n } from '@/lib/i18n/server';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { t } from '@/lib/i18n';
import { auditsByYear, auditGovernments, auditsForGovernment, govFromSlug, govSlug, UNION_GOV } from '@/lib/audits';
import { extractsFor } from '@/lib/audit-extracts';
import { formatDate } from '@/lib/format';
import type { CagReport } from '@/lib/types';
import Breadcrumbs from '@/components/Breadcrumbs';
import Icon from '@/components/Icon';

// Weekly self-heal only - this is long-tail content that changes on deploy, and
// every ISR regeneration is a billed write (see README "How data flows" and the
// note on /state).
export const revalidate = 604800;

type Params = { lang: string; gov: string };
type Tr = (k: string, v?: Record<string, string | number>) => string;

/** English-only combos, like every other multi-segment route here - listing all
 *  23 locales would multiply the build by 23 for pages that are mostly links. */
export async function generateStaticParams() {
  return auditGovernments().map((gov) => ({ lang: DEFAULT_LOCALE, gov: govSlug(gov) }));
}

async function governmentName(gov: string): Promise<string | null> {
  if (gov === UNION_GOV) return null; // the caller uses the Union-specific string
  return (await getStateByCode(gov))?.state ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { gov: slug } = await params;
  const gov = govFromSlug(slug);
  if (!gov) return { title: 'CAG audit reports' };
  const state = await governmentName(gov);
  const title = state ? `CAG reports on the Government of ${state}` : 'CAG reports on the Union Government';
  return {
    title,
    description: `Reports of the Comptroller and Auditor General on ${state ? `the Government of ${state}` : 'the Union government'}, linked to the original PDFs on cag.gov.in.`,
    alternates: { canonical: `/audits/${govSlug(gov)}` },
  };
}

/**
 * One report.
 *
 * Reads top to bottom as: what was audited, over what period, what the
 * Comptroller actually wrote, and where to read it in full. The extracts are
 * the Comptroller's own sentences with the page they sit on (see
 * lib/audit-extracts.ts) - collapsed by default so the year still scans as a
 * list, and rendered as <details> so the whole page ships zero client JS.
 */
function ReportCard({ r, tr }: { r: CagReport; tr: Tr }) {
  const extracts = extractsFor(r.source_url);
  return (
    <li className="rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-base font-bold leading-snug text-ink">{r.title}</h3>

      {/* A description list, so each value is announced with what it is. The
          visible text is the bare value - "Report number: Report No. 5 of 2026"
          is what you get if the label and the value both spell it out. */}
      <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">{tr('audits.reportNoLabel')}</dt>
          <Icon name="law" size={12} className="shrink-0" aria-hidden="true" />
          <dd>{r.report_no}</dd>
        </div>
        {r.as_of && (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">{tr('audits.auditPeriodLabel')}</dt>
            <Icon name="calendar" size={12} className="shrink-0" aria-hidden="true" />
            <dd>{r.as_of}</dd>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">{tr('audits.tabledLabel')}</dt>
          <Icon name="parliament" size={12} className="shrink-0" aria-hidden="true" />
          <dd>{r.year}</dd>
        </div>
      </dl>

      {extracts.length > 0 && (
        <details className="group mt-3 rounded-xl bg-paper-soft">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-ink marker:hidden">
            <Icon name="search" size={14} className="shrink-0 text-brand" />
            {tr('audits.findingsTitle')}
            <span className="font-normal text-ink-faint">
              ({tr('audits.findingsCount', { n: extracts.length })})
            </span>
            <span className="ml-auto text-xs font-normal text-ink-faint group-open:hidden">{tr('common.readMore')}</span>
          </summary>
          <div className="px-3.5 pb-3.5">
            <p className="text-xs text-ink-faint">{tr('audits.extractNote')}</p>
            <ul className="mt-3 space-y-3">
              {extracts.map((e, i) => (
                <li key={i} className="border-l-2 border-brand/30 pl-3">
                  <blockquote className="text-sm leading-relaxed text-ink-soft">{`"${e.quote}"`}</blockquote>
                  <p className="mt-1 text-xs text-ink-faint">
                    {tr('audits.pageRef', { page: e.page })}
                    {e.section && ` · ${e.section}`}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {/* We link, we never fetch or embed: nothing from cag.gov.in is on this
          page's critical path. The [PDF] label is there so nobody on a metered
          connection taps it blind. */}
      <a
        href={r.source_url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        <Icon name="external" size={13} className="shrink-0" /> {tr('audits.openPdf')}
        <span className="font-normal text-ink-faint">({tr('audits.pdfNote')})</span>
      </a>
    </li>
  );
}

/**
 * One government's audit index.
 *
 * Grouped by tabling year, newest first, and ordered by nothing else. There is
 * deliberately no severity, no category and no ranking here.
 */
export default async function AuditGovPage({ params }: { params: Promise<Params> }) {
  const { lang, gov: slug } = await params;
  const gov = govFromSlug(slug);
  if (!gov) notFound();

  const { dict, locale } = await getI18n(lang);
  const tr: Tr = (k, v) => t(dict, k, v);

  const state = await governmentName(gov);
  const all = auditsForGovernment(gov);
  const years = auditsByYear(gov);
  const title = state ? tr('audits.govTitleState', { state }) : tr('audits.govTitleUnion');
  const intro = state ? tr('audits.govIntroState', { state }) : tr('audits.govIntroUnion');
  const retrieved = all[0]?.retrieved_date;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Breadcrumbs
        items={[
          { label: tr('levels.national'), href: '/' },
          { label: tr('audits.title'), href: '/audits' },
          { label: state ?? tr('audits.unionShort') },
        ]}
      />

      <h1 className="mt-3 flex items-start gap-2 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        <Icon name="scales" size={26} className="mt-1 shrink-0 text-brand" /> {title}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-soft">{intro}</p>

      <p className="mt-4 rounded-2xl border border-warn/30 bg-warn-soft/40 p-3.5 text-sm text-ink-soft">
        {tr('audits.caveat')}
      </p>

      {all.length === 0 ? (
        // Never an empty page, and never a zero styled as a score: a government
        // with nothing indexed here has nothing indexed here, which is a fact
        // about our index and not about the government.
        <div className="mt-6 rounded-2xl border border-line bg-paper-soft p-5">
          <p className="text-sm text-ink-soft">{tr('audits.emptyGov')}</p>
          <a
            href="https://cag.gov.in/en/audit-report"
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <Icon name="external" size={14} /> {tr('audits.cagSite')}
          </a>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-faint">
            {all.length === 1 ? tr('audits.reportCountOne') : tr('audits.reportCount', { n: all.length })}
            {retrieved && ` · ${tr('common.lastUpdated')} ${formatDate(retrieved, locale)}`}
          </p>

          <div className="mt-6 space-y-8">
            {years.map(({ year, reports }) => (
              <section key={year}>
                <h2 className="sticky top-0 z-10 -mx-1 bg-paper/95 px-1 py-2 text-lg font-extrabold text-ink backdrop-blur">
                  {year}
                  <span className="ml-2 text-sm font-normal text-ink-faint">
                    {reports.length === 1 ? tr('audits.reportCountOne') : tr('audits.reportCount', { n: reports.length })}
                  </span>
                </h2>
                <ul className="mt-2 space-y-3">
                  {reports.map((r) => (
                    <ReportCard key={r.source_url} r={r} tr={tr} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <p className="mt-8 border-t border-line pt-4 text-xs text-ink-faint">
        {tr('common.source')}: {all[0]?.source_name ?? 'Comptroller and Auditor General of India'} ·{' '}
        <Link href="/audits" className="text-brand hover:underline">
          {tr('audits.title')}
        </Link>
      </p>
    </div>
  );
}
