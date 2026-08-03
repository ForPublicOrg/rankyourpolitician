import type { Constituency } from './types';

type ConstituencyLocation = Pick<Constituency, 'id' | 'name' | 'stateCode' | 'type' | 'districts'>;

/**
 * A city can also lend its name to an Assembly constituency. When that seat is
 * wholly inside the identically named district, two geographic landing pages
 * make readers choose between overlapping views of the same place. District is
 * the richer civic scope (officials, every representative and every seat), so
 * it is the canonical locality URL in this narrow, unambiguous case.
 */
export function canonicalDistrictForConstituency(
  constituency: Pick<ConstituencyLocation, 'name' | 'type' | 'districts'>,
): string | null {
  if (constituency.type !== 'AC' || constituency.districts.length !== 1) return null;

  const district = constituency.districts[0]?.trim();
  if (!district || normaliseLocalityName(constituency.name) !== normaliseLocalityName(district)) return null;
  return district;
}

/** The reader-facing URL for a constituency, including the canonical city rule. */
export function constituencyHref(constituency: ConstituencyLocation): string {
  const district = canonicalDistrictForConstituency(constituency);
  return district
    ? `/district/${constituency.stateCode}/${encodeURIComponent(district)}`
    : `/area/${constituency.id}`;
}

/**
 * Kept intentionally local to URL canonicalisation. It matches the tolerant
 * district lookup used by the data layer without exporting that server module
 * into client components such as search.
 */
function normaliseLocalityName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

export type { ConstituencyLocation };
