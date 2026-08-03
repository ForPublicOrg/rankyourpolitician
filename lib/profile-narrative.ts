import type { PersonView } from './data';

// A neutral, per-person prose bio for the profile's "About" section. Each clause
// is drawn only from data already on the page (seat, house, party, tenure,
// executive office, jurisdiction - all cited in the identity/record sections);
// nothing is inferred or added from memory, so "missing beats wrong" holds - a
// field we do not have simply drops its sentence. This exists to give every
// enriched profile real prose instead of the single templated line the importers
// generate. It is English, matching the stored neutral_summary (profile data is
// not localised); the surrounding UI chrome stays translated.
//
// Neutrality: this narrates only role and biography, never the affidavit figures
// (assets, declared cases) - those stay as the plain, cited tiles below, with no
// prose framing that could read as a verdict. Pronouns default to they/them.

/** "A", "A and B", "A, B and C" - plain "and", no serial-comma dashes. */
function joinList(items: string[]): string {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a[0] ?? '';
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

/** The opening sentence: who they are and which house/seat they hold. */
function leadSentence(p: PersonView): string {
  const seat = p.constituency;
  const state = p.state;
  switch (p.house) {
    case 'Lok Sabha':
      return (
        `${p.name} is the Member of Parliament (MP)` +
        (seat ? ` for the ${seat} constituency` : '') +
        (state ? ` in ${state}` : '') +
        `, sitting in the 18th Lok Sabha - the directly elected lower house of India's Parliament.`
      );
    case 'Rajya Sabha':
      return (
        `${p.name} is a Member of Parliament in the Rajya Sabha, the Council of States and upper house of India's Parliament` +
        (state ? `, representing ${state}` : '') +
        `.`
      );
    case 'Vidhan Sabha':
      return (
        `${p.name} is the Member of the Legislative Assembly (MLA)` +
        (seat ? ` for the ${seat} constituency` : '') +
        (state ? ` in ${state}` : '') +
        `.`
      );
    case 'Vidhan Parishad':
      return (
        `${p.name} is a Member of the Legislative Council (MLC)` +
        (state ? ` in ${state}` : '') +
        `, the Vidhan Parishad - the upper house of the state legislature.`
      );
    default:
      return p.current_position ? `${p.name} is ${p.current_position}.` : `${p.name} is an elected representative.`;
  }
}

/**
 * Ordered prose paragraphs for the About section. Returns an empty array when
 * there is nothing substantive to say (the caller then falls back to the stored
 * neutral_summary). Only ever called for elected profiles.
 */
export function profileNarrative(p: PersonView): string[] {
  if (p.kind !== 'elected') return [];

  // Paragraph 1 - identity, party, tenure, any executive office. The lead names
  // the person; follow-on sentences use singular "they" so the name does not
  // repeat awkwardly (and it is the correct neutral pronoun default).
  const first: string[] = [leadSentence(p)];

  if (p.party) first.push(`They currently sit as a member of ${p.party}.`);

  if (p.terms_served && p.terms_served > 0) {
    const n = p.terms_served;
    first.push(`They have ${n} ${n === 1 ? 'term' : 'terms'} of legislative service on record.`);
  }

  if (p.is_pm) {
    first.push(`They also serve as the Prime Minister of India, heading the Union Council of Ministers.`);
  } else if (p.current_position && (p.portfolios.length > 0 || p.govScope === 'state' || p.is_minister)) {
    let exec = `They additionally serve as ${p.current_position}`;
    if (p.portfolios.length > 0) {
      const shown = p.portfolios.slice(0, 3);
      const extra = p.portfolios.length - shown.length;
      const list = joinList(shown) + (extra > 0 ? `, and ${extra} more` : '');
      exec += `, holding the ${list} portfolio${p.portfolios.length === 1 && extra === 0 ? '' : 's'}`;
    }
    first.push(exec + '.');
  }

  // Paragraph 2 - jurisdiction. Skip when the only district just repeats the
  // seat name (nothing gained), and only for constituency-based houses.
  const second: string[] = [];
  const constituencyHouse = p.house === 'Lok Sabha' || p.house === 'Vidhan Sabha';
  const districts = p.districts.filter(Boolean);
  const redundant = districts.length === 1 && districts[0] === p.constituency;
  if (constituencyHouse && districts.length > 0 && !redundant) {
    const seatName = p.constituency ? `The ${p.constituency} seat` : 'This seat';
    second.push(`${seatName} covers ${joinList(districts)}.`);
  }

  return [first.join(' '), second.join(' ')].filter((para) => para.trim().length > 0);
}
