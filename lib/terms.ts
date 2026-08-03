import termsSeed from '@/data/seed/legislature_terms.json';
import type { House, LegislatureTerm, LegislatureTermsFile, RoleTerm } from './types';

const TERMS = termsSeed as LegislatureTermsFile;
const ASSEMBLY_BY_STATE = new Map(TERMS.assemblies.map((term) => [term.stateCode, term]));

export function legislatureTerms(): LegislatureTermsFile {
  return TERMS;
}

function parseLegacyUpperHouseTerm(summary?: string): Pick<LegislatureTerm, 'from' | 'to'> | null {
  const match = summary?.match(/Current term:\s*(\d{2}-[A-Za-z]{3}-\d{4})\s+to\s+(\d{2}-[A-Za-z]{3}-\d{4})/);
  if (!match) return null;
  const toIso = (value: string) => {
    const [day, month, year] = value.split('-');
    const monthNumber = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(month.toLowerCase()) + 1;
    return monthNumber ? `${year}-${String(monthNumber).padStart(2, '0')}-${day}` : value;
  };
  return { from: toIso(match[1]), to: toIso(match[2]) };
}

export function electedRoleTerm(person: {
  house?: string;
  stateCode?: string;
  term_start?: string;
  term_end?: string;
  neutral_summary?: string;
  identity_source?: { url: string; name: string; retrieved_date: string };
}): RoleTerm | null {
  const source = {
    source_url: TERMS.source_url,
    source_name: TERMS.source_name,
    retrieved_date: TERMS.retrieved_date,
  };
  if (person.house === 'Lok Sabha') {
    return { role: 'Lok Sabha', ...TERMS.lok_sabha, ...source, basis: 'house' };
  }
  if (person.house === 'Vidhan Sabha' && person.stateCode) {
    const term = ASSEMBLY_BY_STATE.get(person.stateCode);
    return term ? { role: 'Vidhan Sabha', from: term.from, to: term.to, ...source, basis: 'house' } : null;
  }
  if (person.house === 'Rajya Sabha' || person.house === 'Vidhan Parishad') {
    const explicit = person.term_start && person.term_end
      ? { from: person.term_start, to: person.term_end }
      : parseLegacyUpperHouseTerm(person.neutral_summary);
    if (!explicit) return null;
    return {
      role: person.house as House,
      ...explicit,
      source_url: person.identity_source?.url || '',
      source_name: person.identity_source?.name || '',
      retrieved_date: person.identity_source?.retrieved_date || '',
      basis: 'member',
    };
  }
  return null;
}

/** Assemblies whose normal terms expire next. This is a due-date forecast, not
 * an invented poll schedule: ECI will publish actual voting dates separately. */
export function nextAssemblyElections(now = Date.now(), limit = 5, excludeStateCodes: ReadonlySet<string> = new Set()): LegislatureTerm[] {
  const today = new Date(now).toISOString().slice(0, 10);
  return TERMS.assemblies
    .filter((term) => term.to >= today && !excludeStateCodes.has(term.stateCode))
    .sort((a, b) => a.to.localeCompare(b.to))
    .slice(0, limit);
}

export function constitutionalRoleTerm(office: 'president' | 'vice_president'): RoleTerm {
  return {
    role: office,
    ...TERMS.constitutional_offices[office],
    source_url: TERMS.source_url,
    source_name: TERMS.source_name,
    retrieved_date: TERMS.retrieved_date,
    basis: 'member',
  };
}
