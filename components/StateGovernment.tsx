import Link from 'next/link';
import type { StateGovernment, StateMinister } from '@/lib/types';
import { Avatar, PartyChip } from './ui';
import Icon from './Icon';

export interface StateGovLabels {
  title: string; // "{state} Government"
  cm: string;
  deputyCm: string;
  cabinet: string;
  mos: string;
  governor: string;
  holds: string;
  presidentsRule: string;
  /** UT with no legislature - administered through an LG / Administrator. */
  administered: string;
  beingVerified: string;
  verifyNote: string;
  asOf: string;
  sources: string;
}

// Roster grid for a rank group. `auto-fit` collapses empty tracks, so a group
// with a single member (a lone Deputy CM) fills the row instead of sitting in a
// half-width cell with dead space beside it. It is also container-driven rather
// than viewport-driven: this section renders in a ~570px page column on desktop
// but full width once the page stacks, and a `sm:` breakpoint cannot tell those
// apart - it used to force two 255px columns into the narrow one, squeezing the
// portfolio lists into tall thin strips. min(...,100%) keeps it from overflowing
// containers narrower than the track minimum.
const ROSTER_GRID = 'grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))]';

function MinisterRow({ m, featured }: { m: StateMinister; featured?: boolean }) {
  return (
    <Link
      href={`/person/${m.id}`}
      className={`flex items-start gap-3 rounded-2xl border border-line bg-white p-4 shadow-soft transition hover:border-brand/40 hover:shadow-lift ${featured ? 'sm:p-5' : ''}`}
    >
      <Avatar name={m.name} src={m.photo_url} size={featured ? 60 : 46} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-bold text-ink ${featured ? 'text-lg' : ''}`}>{m.name}</span>
          {m.party && <PartyChip party={m.party} />}
        </div>
        {m.portfolios.length > 0 && (
          <p className="mt-1 text-sm text-ink-soft">{m.portfolios.join(', ')}</p>
        )}
      </div>
      <Icon name="chevron" size={16} className="-rotate-90 shrink-0 text-ink-faint" />
    </Link>
  );
}

export default function StateGovernmentSection({ gov, labels }: { gov: StateGovernment; labels: StateGovLabels }) {
  const cm = gov.ministers.find((m) => m.rank === 'CM');
  const dycms = gov.ministers.filter((m) => m.rank === 'DyCM');
  const cabinet = gov.ministers.filter((m) => m.rank === 'Cabinet');
  const mos = gov.ministers.filter((m) => m.rank === 'MoS');
  // The workflow's asOf is a verbose sentence starting "as of …"; keep just the date phrase.
  const asOfShort = gov.asOf ? gov.asOf.replace(/^\s*as of\s*/i, '').split(/[;(]/)[0].trim() : '';

  return (
    <section className="rounded-3xl border border-line bg-paper-soft p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
          <Icon name="flag" size={20} className="text-brand" /> {labels.title}
        </h2>
        {asOfShort && <span className="text-xs text-ink-faint">{labels.asOf} {asOfShort}</span>}
      </div>

      {gov.governmentStatus === 'presidents_rule' ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-ink">{labels.presidentsRule}</p>
      ) : gov.governmentStatus === 'administered' ? (
        <p className="mt-3 rounded-xl bg-paper-soft p-3 text-sm text-ink-soft">{labels.administered}</p>
      ) : (
        <>
          {(gov.confidence !== 'high' || gov.governmentStatus === 'uncertain') && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-ink">
              <Icon name="info" size={16} className="mt-0.5 shrink-0 text-rating-ink" /> {labels.beingVerified}
            </p>
          )}
          <div className="mt-4 space-y-4">
            {cm && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">{labels.cm}</p>
                <MinisterRow m={cm} featured />
              </div>
            )}
            {dycms.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">{labels.deputyCm}</p>
                <div className={ROSTER_GRID}>
                  {dycms.map((m) => <MinisterRow key={m.id} m={m} />)}
                </div>
              </div>
            )}
            {cabinet.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">{labels.cabinet}</p>
                <div className={ROSTER_GRID}>
                  {cabinet.map((m) => <MinisterRow key={m.id} m={m} />)}
                </div>
              </div>
            )}
            {mos.length > 0 && (
              <details className="rounded-2xl border border-line bg-white">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-brand">
                  {labels.mos} ({mos.length}) <Icon name="chevron" size={16} />
                </summary>
                <div className={`${ROSTER_GRID} border-t border-line p-3`}>
                  {mos.map((m) => <MinisterRow key={m.id} m={m} />)}
                </div>
              </details>
            )}
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-ink-faint">{labels.verifyNote}</p>

      {gov.governor?.name && (
        <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-sm text-ink-soft">
          <Icon name="shield" size={15} className="text-ink-faint" />
          <span className="font-semibold">{gov.governor.title || labels.governor}:</span> {gov.governor.name}
        </p>
      )}
      {gov.sources.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
          <span className="font-semibold">{labels.sources}:</span>
          {gov.sources.slice(0, 3).map((s, i) => {
            let host = s;
            try { host = new URL(s).hostname.replace(/^www\./, ''); } catch { /* keep */ }
            return <a key={i} href={s} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline">{host}</a>;
          })}
        </p>
      )}
    </section>
  );
}
