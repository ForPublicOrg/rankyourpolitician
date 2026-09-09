// Joins the Union Council of Ministers to the Ministries and Departments that
// actually exist.
//
// Two sources meet here. central_government.json says which PORTFOLIO each
// minister holds, in the wording of the council list ("Home Affairs", "Jal
// Shakti", "Department of Space"). union_ministries.json is the Cabinet
// Secretariat's First Schedule, which says which MINISTRIES exist and which
// Departments sit inside each ("Ministry of Home Affairs" with its six
// departments). Neither file is edited to fit the other; this module matches
// them by a punctuation-blind key, so the schedule can be re-imported verbatim
// and the council list can keep the wording its own source uses.
//
// Pure functions - safe on server and client, no I/O.
import type { Minister, UnionMinistry } from './types';

/**
 * Punctuation-blind key for a ministry / department / portfolio name.
 * "Ministry of Agriculture and Farmers Welfare", "Agriculture and Farmers'
 * Welfare" and "Agriculture & Farmers Welfare" all reduce to the same key.
 * "Co-operation" and "Cooperation" likewise. The "(Independent Charge)" and
 * "(additional charge)" suffixes describe the minister, not the ministry.
 */
export function portfolioKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((independent|additional)\s+charge\)/g, ' ')
    .replace(/\bministry of\b/g, ' ')
    .replace(/\bminister of\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/'s\b/g, 's')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** The Prime Minister's residual clause is a description of the office, not a
 *  ministry, so it never joins to anything. */
export function isResidualClause(portfolio: string): boolean {
  return (
    /not allocated to any minister/i.test(portfolio) ||
    /^all important policy/i.test(portfolio) ||
    // The office itself, listed as a "portfolio" on the council list.
    /^prime minister$/i.test(portfolio.trim())
  );
}

/** Every key that reaches a schedule entry: its own name plus each of its
 *  departments (a minister holding "Department of Space" holds that entry). */
export function ministryKeys(entry: UnionMinistry): string[] {
  return [portfolioKey(entry.name), ...entry.departments.map((d) => portfolioKey(d.name))];
}

/** The schedule entry a portfolio string names, or undefined when the council
 *  list uses a wording the schedule does not (validate warns on those). */
export function ministryForPortfolio(entries: UnionMinistry[], portfolio: string): UnionMinistry | undefined {
  if (isResidualClause(portfolio)) return undefined;
  const key = portfolioKey(portfolio);
  if (!key) return undefined;
  return entries.find((e) => ministryKeys(e).includes(key));
}

export interface MinistryHolders {
  /** Ministers who head the ministry: the PM, Cabinet ministers and Ministers
   *  of State with independent charge. Usually one; two when a charge is split
   *  or held additionally. */
  heads: Minister[];
  /** Ministers of State attached to the ministry. */
  mos: Minister[];
}

/** Who answers for a schedule entry, straight from the council list. Order is
 *  the council list's own (seniority), never ours. */
export function holdersOf(entry: UnionMinistry, ministers: Minister[]): MinistryHolders {
  const keys = new Set(ministryKeys(entry));
  const holds = (m: Minister) => m.portfolios.some((p) => !isResidualClause(p) && keys.has(portfolioKey(p)));
  const heads = ministers.filter((m) => holds(m) && m.rank !== 'MoS');
  const mos = ministers.filter((m) => holds(m) && m.rank === 'MoS');
  return { heads, mos };
}

/** The departments a minister's portfolio string expands to, for the profile
 *  page: "Finance" -> the five departments of the Ministry of Finance. A
 *  portfolio that names a single department ("Department of Space") expands to
 *  nothing - the department is the whole of what they hold. */
export function departmentsForPortfolio(entries: UnionMinistry[], portfolio: string): { ministry: UnionMinistry; departments: UnionMinistry['departments'] } | undefined {
  const entry = ministryForPortfolio(entries, portfolio);
  if (!entry) return undefined;
  const namesDepartment = entry.departments.some((d) => portfolioKey(d.name) === portfolioKey(portfolio));
  return { ministry: entry, departments: namesDepartment ? [] : entry.departments };
}

/** Portfolio strings on the council list that join to no schedule entry -
 *  what `dm validate` reports so a wording drift is caught at import, not by
 *  a reader seeing a ministry with nobody in charge. */
export function unmatchedPortfolios(entries: UnionMinistry[], ministers: Minister[]): string[] {
  const out = new Set<string>();
  for (const m of ministers) {
    for (const p of m.portfolios) {
      if (isResidualClause(p)) continue;
      if (!ministryForPortfolio(entries, p)) out.add(p);
    }
  }
  return [...out].sort();
}
