import Link from 'next/link';
import type { Metadata } from 'next';
import { getStates } from '@/lib/data';
import { getI18n, type LangParams } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import { auditCounts, auditGovernments, auditTotal, auditYearRange, govSlug, UNION_GOV } from '@/lib/audits';
import Breadcrumbs from '@/components/Breadcrumbs';
import Icon from '@/components/Icon';

// Daily self-heal only - the index changes on deploy, and every ISR
// regeneration is a billed write (see README "How data flows").
export const revalidate = 86400;
export { allLocaleStaticParams as generateStaticParams } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: 'CAG audit reports - Union and every state',
  description:
    'Published Comptroller and Auditor General reports for the Union government and every state and Union Territory, linked to the original PDFs on cag.gov.in.',
  alternates: { canonical: '/audits' },
};

/**
 * The audit hub.
 *
 * Every indexed government is listed, alphabetically - never by report count.
 * A "most-audited governments" ordering would turn a document index into a
 * league table, and report volume tracks the size of a government and the
 * Commission's audit cadence, not conduct.
 */
export default async function AuditsPage({ params }: { params: Promise<LangParams> }) {
  const { lang } = await params;
  const { dict } = await getI18n(lang);
  const tr = (k: string, v?: Record<string, string | number>) => t(dict, k, v);

  const states = await getStates();
  const counts = auditCounts();
  const range = auditYearRange();

  // Governments come from the INDEX, not from the full state list. The state
  // list also holds Union Territories with no legislature of their own
  // (Andaman & Nicobar, Chandigarh, Ladakh and the like) - the Comptroller
  // audits those under the Union, so listing them here at "0 reports" would
  // read as "never audited", which is false. What is listed is exactly what is
  // indexed, and `dm validate` warns if any government falls out of the index.
  const nameByCode = new Map(states.map((s) => [s.stateCode, s.state]));
  const rows = [
    { gov: UNION_GOV, label: tr('audits.union') },
    ...auditGovernments()
      .filter((gov) => gov !== UNION_GOV)
      .map((gov) => ({ gov, label: nameByCode.get(gov) ?? gov }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en')),
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Breadcrumbs items={[{ label: tr('levels.national'), href: '/' }, { label: tr('audits.title') }]} />

      <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight text-ink">
        <Icon name="scales" size={28} className="shrink-0 text-brand" /> {tr('audits.title')}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-soft">{tr('audits.hubIntro')}</p>

      <p className="mt-3 text-sm text-ink-faint">
        {tr('audits.scope', { states: rows.length - 1 })}
        {range && ` ${tr('audits.scopeCount', { n: auditTotal(), from: range.from, to: range.to })}`}
      </p>

      <p className="mt-4 rounded-2xl border border-warn/30 bg-warn-soft/40 p-3.5 text-sm text-ink-soft">
        {tr('audits.caveat')}
      </p>

      <h2 className="mt-8 text-lg font-bold text-ink">{tr('audits.governmentsTitle')}</h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map(({ gov, label }) => {
          const n = counts.get(gov) ?? 0;
          return (
            <li key={gov}>
              <Link
                href={`/audits/${govSlug(gov)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-sm transition hover:border-brand/40 hover:shadow-soft"
              >
                <span className="min-w-0 truncate font-medium text-ink">{label}</span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {n === 1 ? tr('audits.reportCountOne') : tr('audits.reportCount', { n })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Provenance. The index was seeded from a publicly compiled list and then
          checked report-by-report against the Commission's own site; saying so
          plainly is more honest than a bare "Source: CAG" on data we did not
          discover unaided. Nothing the compiler added travels with the data. */}
      <p className="mt-8 border-t border-line pt-4 text-xs text-ink-faint">
        {tr('audits.sourceNote', { compiler: 'andhbhakt.org' })}
      </p>
    </div>
  );
}
