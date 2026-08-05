/**
 * Which district administers an Assembly constituency, from the Election
 * Commission's own roll-administration data.
 *
 * WHY THIS EXISTS. `districts` on a Constituency was originally filled by
 * tools/geo/prepare-geo.ts, joining the DataMeet boundary files (2008
 * delimitation, census-2011 district names) by normalised name. That join left
 * 315 seats empty, in two classes it could never have solved:
 *   - seats created by a LATER delimitation (Assam 2023, J&K 2022) - they are
 *     simply not in a 2008-vintage file, so no parser fix reaches them; and
 *   - seats whose roster spelling drifted from the boundary file's spelling.
 * It also froze every district at its 2001/2011 name, so seats sit in districts
 * that have since been renamed (Karimganj -> Sribhumi) or carved up (Sonitpur
 * -> Biswanath). A stale district is not a cosmetic problem here: the district
 * is what resolves the DM/Collector and SP in the "who fixes what" ladder, so a
 * reader is sent to an office that does not administer them.
 *
 * THE SOURCE. The ECI's Voter Services Portal serves the electoral roll as a
 * district -> constituency tree, because rolls are administered district-wise.
 * That tree IS the Commission's own statement of which district administers
 * each seat, it is machine-readable, it is current, and it covers every state
 * uniformly. It is the same tier-1 authority this repo already prefers for
 * election data (see lib/eci-results.ts).
 *
 * WHAT THIS MODULE IS. Pure functions and reviewed lookup tables only - no
 * network, no filesystem - so tools/data-manager/ac-districts.regress.ts can
 * exercise every matching rule against captured fixtures.
 */

/** One row of the ECI district -> AC tree, flattened. */
export interface EciAcRow {
  stateCd: string;
  districtCd: string;
  /** District name exactly as the ECI serves it (upper case, sometimes padded). */
  district: string;
  acNo: number;
  /** AC name exactly as the ECI serves it. */
  ac: string;
  pcNo: string;
}

/** Our 2-letter state code -> the ECI's own state code. */
export const ECI_STATE_CD: Record<string, string> = {
  AP: 'S01', AR: 'S02', AS: 'S03', BR: 'S04', GA: 'S05', GJ: 'S06', HR: 'S07', HP: 'S08', JK: 'S09',
  KA: 'S10', KL: 'S11', MP: 'S12', MH: 'S13', MN: 'S14', ML: 'S15', MZ: 'S16', NL: 'S17', OD: 'S18',
  PB: 'S19', RJ: 'S20', SK: 'S21', TN: 'S22', TR: 'S23', UP: 'S24', WB: 'S25', CG: 'S26', JH: 'S27',
  UK: 'S28', TG: 'S29', AN: 'U01', CH: 'U02', DN: 'U03', DL: 'U05', LD: 'U06', PY: 'U07', LA: 'U09',
};

/**
 * States where the ECI's "district" is an ELECTORAL district, not the revenue
 * district that has a Collector and an SP. Delhi's roll districts include "Old
 * Delhi", "Central North" and "Outer North", which are not among Delhi's 11
 * revenue districts; Karnataka's include "B.B.M.P(SOUTH)" and "B.B.M.P(CENTRAL)",
 * which are municipal corporation zones. Writing those would give the
 * escalation ladder a district office that does not exist, so this importer
 * refuses to touch these states until a revenue-district source is added for
 * them. Listed explicitly rather than guessed at: silence here would be the
 * expensive kind of wrong.
 */
export const ELECTORAL_DISTRICT_STATES = new Set(['DL', 'KA']);

/**
 * Roster spelling -> the ECI's spelling, for seats that are the same seat under
 * a different romanisation. Every pair below was confirmed by a whole-state
 * bijection: the state's seed seats and the ECI's seats match 1:1 with these
 * pairs and cannot match any other way (see matchState's `complete` flag).
 * Nothing is matched by edit distance - "Dharashiv" is one edit from "Dharavi"
 * and 400 km away from it, and that class of near-miss is exactly what the
 * no-guessing rule exists to stop.
 */
export const SEAT_ALIASES: Record<string, Record<string, string>> = {
  AS: {
    'Bhowanipur-Sorbhog': 'BHAWANIPUR-SORBHOG',
    Dudhnai: 'DUDHNOI',
    Goreshwar: 'GORESWAR',
    Jaleshwar: 'JALESWAR',
    Majbat: 'MAZBAT',
    Nadaur: 'NADUAR',
    Naoboicha: 'NOWBOICHA',
    Rangiya: 'RANGIA',
    Rupohihat: 'RUPAHIHAT',
  },
};

/**
 * ECI district spelling -> the display name to store, where the ECI's own
 * string is noise rather than a name. Keyed by state, then by the NORMALISED
 * ECI name. This is deliberately tiny: a district that the ECI merely spells
 * differently from an older vintage (Morigaon vs Marigaon) is NOT aliased back,
 * because the ECI's spelling is the current one and re-aligning to it is the
 * point of this importer.
 */
export const DISTRICT_DISPLAY: Record<string, Record<string, string>> = {
  // "KAMRUP." (trailing full stop) and "KAMRUP (METRO)" are two real, distinct
  // Assam districts; only the stray punctuation needs repairing.
  AS: { kamrup: 'Kamrup' },
};

/**
 * A parliamentary constituency covers whole assembly constituencies, so its
 * districts are the union of its ACs' districts - which the ECI tree already
 * states, via the pcNo it carries on every AC. The one thing that tree does not
 * carry is the PC's name in English, so each state needs its own cited
 * number -> name list before its PCs can be filled. Adding a state here is the
 * whole cost of extending PC coverage to it; without an entry the importer
 * leaves that state's PCs alone rather than guessing at the numbering.
 */
export interface PcNumbering {
  source_url: string;
  source_name: string;
  /** The Commission's PC number -> the PC's name, as the source prints it. */
  names: Record<number, string>;
}

export const PC_NUMBERS: Record<string, PcNumbering> = {
  // Post-2023-delimitation numbering. Reservation qualifiers are kept exactly as
  // printed; normaliseName drops them when joining to our seat names.
  AS: {
    source_url: 'https://ceoassam.nic.in/lok_sabha/2024/AbstractStatement/Abstract_stat_PCwise_2024.html',
    source_name:
      'Chief Electoral Officer, Assam - General Election to Lok Sabha 2024, PC-wise abstract statement',
    names: {
      1: 'Kokrajhar (ST)', 2: 'Dhubri', 3: 'Barpeta', 4: 'Darrang-Udalguri', 5: 'Guwahati',
      6: 'Diphu (ST)', 7: 'Karimganj', 8: 'Silchar (SC)', 9: 'Nagaon', 10: 'Kaziranga',
      11: 'Sonitpur', 12: 'Lakhimpur', 13: 'Dibrugarh', 14: 'Jorhat',
    },
  },
};

/** Words that stay lower case inside a title-cased district name. */
const SMALL_WORDS = new Set(['and', 'of', 'the']);

/**
 * "SOUTH SALMARA MANKACHAR" -> "South Salmara Mankachar", "KAMRUP (METRO)" ->
 * "Kamrup (Metro)". The ECI pads and upper-cases these strings, so trailing
 * spaces and a trailing full stop are formatting, not name.
 */
export function cleanDistrictName(raw: string, stateCode?: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
  const titled = trimmed
    .toLowerCase()
    .replace(/(^|[\s('/-])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    .replace(/\b(And|Of|The)\b/g, (w) => (SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w));
  const override = stateCode ? DISTRICT_DISPLAY[stateCode]?.[normaliseDistrict(titled)] : undefined;
  return override ?? titled;
}

/**
 * Join key for constituency and district names. Parenthesised text is dropped
 * because it is almost always a reservation qualifier - "(SC)", "(ST)" - but
 * note this is used ONLY to compare names that are already known to be seats in
 * the same state, never to compare a seat against a district.
 */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Join key for DISTRICT names. This must mirror normSimple in lib/data.ts
 * exactly, because that is the function that actually routes
 * /district/{stateCode}/{name} - if two names compare equal here they land on
 * one page, and if they do not they become two pages.
 *
 * Deliberately NOT normaliseName: that one drops parenthesised text, which is
 * right for seats (it strips "(SC)"/"(ST)" reservation qualifiers) and wrong
 * for districts, where "Kamrup" and "Kamrup (Metro)" are two real Assam
 * districts holding different seats.
 */
export function normaliseDistrict(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

export interface SeatLike {
  id: string;
  name: string;
  districts: string[];
}

export interface SeatMatch {
  seat: SeatLike;
  eci: EciAcRow;
  district: string;
  /** How the seat was joined to the ECI row - for the report and the audit trail. */
  via: 'name' | 'alias';
  /** What this importer would do to the row. */
  action: 'fill' | 'realign' | 'unchanged';
}

export interface MatchReport {
  stateCode: string;
  matches: SeatMatch[];
  /** Seed seats with no unambiguous ECI counterpart. */
  unmatchedSeats: SeatLike[];
  /** ECI seats no seed seat claimed. */
  unclaimedEci: EciAcRow[];
  /** Seed names that hit more than one ECI seat - never resolved by guessing. */
  ambiguous: { seat: SeatLike; candidates: EciAcRow[] }[];
  /**
   * True only when every seed seat matched exactly one ECI seat AND every ECI
   * seat was claimed exactly once. A partial match means the two lists describe
   * different things (a stale roster, a missed delimitation), so the importer
   * writes nothing for the state rather than filling the rows it happens to
   * recognise.
   */
  complete: boolean;
}

/**
 * Join one state's seed seats to the ECI's seats. Name equality after
 * normalisation, plus the reviewed alias table. No fuzzy matching, and any
 * name that resolves to more than one ECI seat is reported, never picked.
 */
export function matchState(
  stateCode: string,
  seats: SeatLike[],
  eciRows: EciAcRow[],
): MatchReport {
  const aliases = SEAT_ALIASES[stateCode] ?? {};

  const byName = new Map<string, EciAcRow[]>();
  for (const row of eciRows) {
    const key = normaliseName(row.ac);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(row);
  }

  const matches: SeatMatch[] = [];
  const unmatchedSeats: SeatLike[] = [];
  const ambiguous: MatchReport['ambiguous'] = [];
  const claimed = new Set<EciAcRow>();

  for (const seat of seats) {
    const aliasTarget = aliases[seat.name];
    const key = normaliseName(aliasTarget ?? seat.name);
    const candidates = byName.get(key);
    if (!candidates || candidates.length === 0) {
      unmatchedSeats.push(seat);
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push({ seat, candidates });
      continue;
    }
    const eci = candidates[0];
    if (claimed.has(eci)) {
      // Two seed seats resolving to one ECI seat means the seed has a duplicate,
      // which must be fixed in the roster, not papered over here.
      unmatchedSeats.push(seat);
      continue;
    }
    claimed.add(eci);
    const district = cleanDistrictName(eci.district, stateCode);
    const before = seat.districts ?? [];
    const action: SeatMatch['action'] = before.length === 0
      ? 'fill'
      : before.length === 1 && normaliseDistrict(before[0]) === normaliseDistrict(district)
        ? 'unchanged'
        : 'realign';
    matches.push({ seat, eci, district, via: aliasTarget ? 'alias' : 'name', action });
  }

  const unclaimedEci = eciRows.filter((r) => !claimed.has(r));
  const complete =
    unmatchedSeats.length === 0 && ambiguous.length === 0 && unclaimedEci.length === 0;

  return { stateCode, matches, unmatchedSeats, unclaimedEci, ambiguous, complete };
}

/**
 * Districts that would end up spelled two ways in one state - the failure this
 * importer exists to avoid. Two spellings mean two /district/{code}/{name}
 * pages for one place, each holding half its representatives.
 *
 * Only case, padding and punctuation differences are certain, because
 * /district lookup normalises exactly that far: these ARE one page's worth of
 * data on two pages. See suspectedDistrictSplits for the rest.
 */
export function splitDistricts(districtNames: Iterable<string>): string[][] {
  const byNorm = new Map<string, Set<string>>();
  for (const name of districtNames) {
    const key = normaliseDistrict(name);
    if (!key) continue;
    if (!byNorm.has(key)) byNorm.set(key, new Set());
    byNorm.get(key)!.add(name);
  }
  return [...byNorm.values()].filter((s) => s.size > 1).map((s) => [...s].sort());
}

export interface PcMatch {
  seat: SeatLike;
  pcNo: number;
  districts: string[];
  action: 'fill' | 'realign' | 'unchanged';
}

export interface PcMatchReport {
  matches: PcMatch[];
  unmatchedSeats: SeatLike[];
  /** PC numbers from the cited list that no seed PC claimed. */
  unclaimedNumbers: number[];
  complete: boolean;
}

/**
 * Districts of each parliamentary constituency, as the union of the districts
 * of the assembly constituencies it contains. Same completeness discipline as
 * matchState: the seed's PCs and the cited numbering must line up 1:1, or the
 * caller writes nothing.
 */
export function matchPcs(
  stateCode: string,
  seats: SeatLike[],
  eciRows: EciAcRow[],
): PcMatchReport {
  const numbering = PC_NUMBERS[stateCode];
  if (!numbering) {
    return { matches: [], unmatchedSeats: seats, unclaimedNumbers: [], complete: false };
  }

  const districtsByPc = new Map<number, Set<string>>();
  for (const row of eciRows) {
    const pcNo = Number(row.pcNo);
    if (!Number.isFinite(pcNo)) continue;
    if (!districtsByPc.has(pcNo)) districtsByPc.set(pcNo, new Set());
    districtsByPc.get(pcNo)!.add(cleanDistrictName(row.district, stateCode));
  }

  const numberByName = new Map<string, number[]>();
  for (const [no, name] of Object.entries(numbering.names)) {
    const key = normaliseName(name);
    if (!numberByName.has(key)) numberByName.set(key, []);
    numberByName.get(key)!.push(Number(no));
  }

  const matches: PcMatch[] = [];
  const unmatchedSeats: SeatLike[] = [];
  const claimed = new Set<number>();
  for (const seat of seats) {
    const candidates = numberByName.get(normaliseName(seat.name));
    if (!candidates || candidates.length !== 1 || claimed.has(candidates[0])) {
      unmatchedSeats.push(seat);
      continue;
    }
    const pcNo = candidates[0];
    const districts = [...(districtsByPc.get(pcNo) ?? [])].sort();
    if (districts.length === 0) { unmatchedSeats.push(seat); continue; }
    claimed.add(pcNo);
    const before = (seat.districts ?? []).slice().sort();
    const same =
      before.length === districts.length &&
      before.every((d, i) => normaliseDistrict(d) === normaliseDistrict(districts[i]));
    matches.push({
      seat,
      pcNo,
      districts,
      action: before.length === 0 ? 'fill' : same ? 'unchanged' : 'realign',
    });
  }

  const unclaimedNumbers = Object.keys(numbering.names)
    .map(Number)
    .filter((n) => !claimed.has(n));
  return {
    matches,
    unmatchedSeats,
    unclaimedNumbers,
    complete: unmatchedSeats.length === 0 && unclaimedNumbers.length === 0,
  };
}

/**
 * A romanisation-insensitive skeleton of an Indian place name: the consonants,
 * with the choices that differ between transliterations folded away.
 *
 * Two spellings of one district differ in exactly these ways - "Sivasagar" and
 * "Sibsagar" (v/b, dropped vowel), "Paschim" and "Pashchim" (aspirate
 * placement), "Marigaon" and "Morigaon" (vowel). Two genuinely different
 * districts do not: "East Godavari"/"West Godavari" and "Panipat"/"Sonipat"
 * differ in a consonant that survives this fold. An earlier edit-distance
 * version of this check flagged both classes alike and drowned the real
 * finding in fifteen false ones.
 */
/**
 * Direction words, in the spellings district names actually use. A district's
 * direction is the one part of its name that is never a transliteration
 * accident: "East Garo Hills" and "South Garo Hills" are two districts, while
 * "Paschim" and "Pashchim" Medinipur are two spellings of one. Compared before
 * the consonant skeleton, which folds "east" and "south" together.
 */
const DIRECTION_WORDS: Record<string, string> = {
  north: 'N', uttar: 'N', uttara: 'N', upper: 'N',
  south: 'S', dakshin: 'S', dakshina: 'S', lower: 'S',
  east: 'E', purba: 'E', purbi: 'E', purv: 'E', purvi: 'E', poorva: 'E', purbo: 'E',
  west: 'W', paschim: 'W', pashchim: 'W', pachim: 'W', pashchimi: 'W', pacchim: 'W',
  central: 'C', madhya: 'C',
};

function directionKey(value: string): string {
  return value
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((w) => DIRECTION_WORDS[w])
    .filter(Boolean)
    .sort()
    .join('');
}

function romanisationSkeleton(value: string): string {
  return normaliseDistrict(value)
    // Aspirates are written inconsistently: sh/s, chh/ch, th/t, bh/b ...
    .replace(/([bcdgjkpstz])h/g, '$1')
    .replace(/c/g, 'k')
    // v/b and s/z alternate freely across transliterations of the same name.
    .replace(/[vw]/g, 'b')
    .replace(/z/g, 's')
    // Vowels carry almost none of the identity; "Marigaon"/"Morigaon".
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1');
}

/**
 * District names in one state that are the same name spelled two ways, and so
 * are probably one district split across two vintages - "Sivasagar" and
 * "Sibsagar", "Paschim Medinipur" and "Pashchim Medinipur". Plain
 * normalisation cannot catch these because they differ by a letter, yet this
 * is exactly the residue a half-finished re-alignment leaves behind.
 *
 * Judgement is deliberately inverted from the seat matcher: there, a near-miss
 * must never be treated as a match; here, a near-miss must never be treated as
 * two distinct districts without a human looking. A false positive costs
 * somebody ten seconds; a false negative ships half a district's
 * representatives on a page nothing links to.
 */
export function suspectedDistrictSplits(districtNames: Iterable<string>): string[][] {
  const unique = [...new Set([...districtNames].map((n) => n?.trim()).filter(Boolean) as string[])];
  const pairs: string[][] = [];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = normaliseDistrict(unique[i]);
      const b = normaliseDistrict(unique[j]);
      if (a === b) continue; // already an exact split, reported by splitDistricts
      if (directionKey(unique[i]) !== directionKey(unique[j])) continue;
      const sa = romanisationSkeleton(unique[i]);
      const sb = romanisationSkeleton(unique[j]);
      // A skeleton of one or two consonants is too thin to mean anything.
      if (sa.length < 3 || sb.length < 3) continue;
      if (sa === sb) pairs.push([unique[i], unique[j]].sort());
    }
  }
  return pairs;
}
