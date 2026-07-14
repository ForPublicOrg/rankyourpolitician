'use client';
// The "actual people" ladder: for a problem + district, the real humans to
// contact in order — local office → DM/SP (named where verified) → the state
// minister whose portfolio owns the department → the Chief Minister — plus the
// district's own MLAs/MPs as the parallel elected lever. Shared by the /who
// Finder and the district page section.
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import { PROBLEM_ROUTES, OFFICE_META } from '@/lib/offices';
import { ministersForProblem, isPoliceProblem, type WhoPerson, type WhoDistrict } from '@/lib/responsibility';
import type { ProblemType, OfficeType } from '@/lib/types';
import { Avatar, Chip } from './ui';
import Icon, { type IconName } from './Icon';

export interface ResponsiblePeopleProps {
  problem: ProblemType;
  area: 'urban' | 'rural';
  stateCode: string;
  state: string;
  asOf?: string;
  cm?: WhoPerson;
  ministers: WhoPerson[];
  district: string;
  people: WhoDistrict;
  /** Compact = embedded on the district page (fewer explainer lines). */
  compact?: boolean;
}

function PersonRow({ p, role, holds }: { p: WhoPerson; role: string; holds?: string[] }) {
  return (
    <Link
      href={`/person/${p.id}`}
      className="pressable flex items-center gap-3 rounded-2xl border border-line/70 bg-white/90 p-3 hover:border-brand/40 hover:shadow-soft"
    >
      <Avatar name={p.name} src={p.photo} size={46} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-bold text-ink">{p.name}</span>
          {p.party && <span className="rounded-full bg-paper-sink px-2 py-0.5 text-[11px] font-semibold text-ink-soft">{p.party}</span>}
        </span>
        <span className="block truncate text-xs text-ink-faint">
          {role}
          {holds && holds.length > 0 ? ` · ${holds.slice(0, 2).join(', ')}` : ''}
        </span>
      </span>
      <Icon name="chevron" size={16} className="-rotate-90 shrink-0 text-ink-faint" />
    </Link>
  );
}

function Step({
  n,
  icon,
  title,
  children,
  last = false,
}: {
  n: number;
  icon: IconName;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative pl-12">
      {!last && <span className="absolute left-[15px] top-9 h-[calc(100%-1.25rem)] w-0.5 rounded bg-gradient-to-b from-brand/40 to-brand/10" aria-hidden />}
      <span className="absolute left-0 top-0.5 grid h-8 w-8 place-items-center rounded-full bg-brand text-sm font-extrabold text-white shadow-soft">
        {n}
      </span>
      <p className="flex items-center gap-1.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
        <Icon name={icon} size={13} /> {title}
      </p>
      <div className="mt-1.5 pb-5">{children}</div>
    </li>
  );
}

export default function ResponsiblePeople({
  problem,
  area,
  stateCode,
  state,
  asOf,
  cm,
  ministers,
  district,
  people,
  compact = false,
}: ResponsiblePeopleProps) {
  const { t } = useI18n();

  // Local first-stop offices for this problem (role-level; below district rank).
  const localOffices = PROBLEM_ROUTES[problem][area].filter(
    (o: OfficeType) => !['collector_dm', 'sp_district'].includes(o),
  );
  const police = isPoliceProblem(problem);
  const deptMinisters = ministersForProblem(ministers, cm?.id, problem, area);
  // CMs often keep key departments (Home, Urban Development…) for themselves.
  const cmHoldsDept = !!cm && ministersForProblem([cm], undefined, problem, area, 1).length > 0;
  const dm = people.officials.find((o) => o.officeType === 'collector_dm');
  const sp = people.officials.find((o) => o.officeType === 'sp_district');

  let n = 0;
  const districtHref = `/district/${stateCode}/${encodeURIComponent(district)}`;

  return (
    <div>
      <ol className="mt-1">
        {/* 1 — the local office (role; no individual name needed) */}
        {localOffices.length > 0 && (
          <Step n={++n} icon={OFFICE_META[localOffices[0]].icon} title={t('who.stepOffice')}>
            <div className="rounded-2xl border border-line/70 bg-white/85 p-3.5">
              <p className="font-bold text-ink">{t(`offices.${localOffices[0]}.label`)}</p>
              <p className="mt-0.5 text-sm text-ink-soft">{t(`offices.${localOffices[0]}.handles`)}</p>
              <p className="mt-1.5 text-xs text-ink-faint">{t(`offices.${localOffices[0]}.escalate`)}</p>
            </div>
          </Step>
        )}

        {/* 2 — district administration: SP for police issues, DM for the rest */}
        <Step n={++n} icon="shield" title={t('who.stepDistrict')}>
          <div className="space-y-2">
            {(police ? (['sp_district', 'collector_dm'] as const) : (['collector_dm'] as const)).map((ot) => {
              const officer = ot === 'collector_dm' ? dm : sp;
              return (
                <div key={ot} className="rounded-2xl border border-line/70 bg-white/85 p-3.5">
                  <p className="flex flex-wrap items-center gap-2 font-bold text-ink">
                    {t(`offices.${ot}.label`)}
                    <span className="text-xs font-semibold text-ink-faint">· {district}</span>
                  </p>
                  {officer?.name ? (
                    <div className="mt-1.5">
                      <p className="font-semibold text-ink">
                        {officer.name}
                        {officer.service && <span className="text-sm font-normal text-ink-faint"> · {officer.service}</span>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        {officer.email && (
                          <a href={`mailto:${officer.email}`} className="inline-flex items-center gap-1 text-brand hover:underline">
                            <Icon name="mail" size={12} /> {officer.email}
                          </a>
                        )}
                        {officer.phone && (
                          <span className="inline-flex items-center gap-1 text-ink-faint"><Icon name="phone" size={12} /> {officer.phone}</span>
                        )}
                        {officer.asOf && <span className="text-ink-faint">{t('officials.verifiedAsOf')} {officer.asOf}</span>}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-ink-faint">{t('officials.currentlyUnknown')}</p>
                  )}
                  <p className="mt-1.5 text-xs text-ink-soft">{t(`offices.${ot}.escalate`)}</p>
                </div>
              );
            })}
          </div>
        </Step>

        {/* 3 — the state minister who runs this department.
             When the CM keeps the department (common for Home), the CM IS this
             step, so the separate CM step below is skipped. */}
        {(() => {
          const cmIsDeptOwner = deptMinisters.length === 0 && cmHoldsDept && !!cm;
          return (
            <>
              <Step n={++n} icon="flag" title={t('who.stepMinister')} last={cmIsDeptOwner}>
                {deptMinisters.length > 0 ? (
                  <div className="space-y-2">
                    {deptMinisters.map((m) => (
                      <PersonRow key={m.id} p={m} role={m.sub || t('profile.minister')} holds={m.portfolios} />
                    ))}
                  </div>
                ) : cmIsDeptOwner ? (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 rounded-xl bg-brand-soft px-3 py-2 text-xs font-semibold text-brand-ink">
                      <Icon name="sparkle" size={14} /> {t('who.cmHoldsDept')}
                    </p>
                    <PersonRow p={cm!} role={`${t('stateGov.cm')}, ${state}`} holds={cm!.portfolios} />
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-line bg-white/80 p-3.5 text-sm text-ink-faint">
                    {t('who.noMinisterMatch', { state })}
                  </p>
                )}
              </Step>

              {!cmIsDeptOwner && (
                <Step n={++n} icon="sparkle" title={t('who.stepCm')} last>
                  {cm ? (
                    <PersonRow p={cm} role={`${t('stateGov.cm')}, ${state}`} />
                  ) : (
                    <p className="rounded-2xl border border-dashed border-line bg-white/80 p-3.5 text-sm text-ink-faint">
                      {t('stateGov.beingVerified')}
                    </p>
                  )}
                </Step>
              )}
            </>
          );
        })()}
      </ol>

      {/* Parallel elected lever — the district's own MLAs and MPs */}
      {(people.mlas.length > 0 || people.mps.length > 0) && (
        <div className="mt-2 rounded-3xl border border-perf/25 bg-perf-soft/40 p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-perf-ink">
            <Icon name="people" size={16} /> {t('who.parallelTitle')}
          </p>
          {!compact && <p className="mt-0.5 text-xs text-ink-soft">{t('who.parallelHelp', { district })}</p>}
          {people.mlas.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-ink-faint">{t('who.mlasLabel')}</p>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {people.mlas.map((p) => (
                  <PersonRow key={p.id} p={p} role={`${t('district.chipMla')} · ${p.sub || ''}`} />
                ))}
              </div>
            </>
          )}
          {people.mps.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-ink-faint">{t('who.mpsLabel')}</p>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {people.mps.map((p) => (
                  <PersonRow key={p.id} p={p} role={`${t('district.chipMp')} · ${p.sub || ''}`} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
        {asOf && <span>{t('who.govAsOf', { date: asOf })}</span>}
        <Link href={districtHref} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
          {t('who.openDistrict', { district })} <Icon name="arrow" size={12} />
        </Link>
      </p>
    </div>
  );
}
