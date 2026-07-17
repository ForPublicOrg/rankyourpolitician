/**
 * Wikitext parsing for state-assembly member rosters, shared by import-mlas
 * and its regression suite (mla-parse.regress.ts).
 *
 * The hard part is BY-ELECTIONS and other mid-term changes: Wikipedia marks
 * them as rowspan continuation rows - the constituency cell spans two rows,
 * the departed incumbent sits in the first and the by-election winner in the
 * second. A parser that requires a constituency link on every row never sees
 * the second row, so the departed member survives (this is how Shiggaon kept
 * showing Basavaraj Bommai months after he moved to the Lok Sabha).
 *
 * Rules:
 *  - A row with a constituency wikilink opens a seat GROUP; if the seat-number
 *    or constituency cell carries rowspan=N (attributes BEFORE the constituency
 *    link - a rowspan inside a later party template is not a seat rowspan),
 *    the next N-1 rows belong to the same group.
 *  - Within a group the LAST row with a member name is the sitting member
 *    (rows are chronological: incumbent first, by-election winner below).
 *    Continuation rows that carry only a party (defection/party-history rows,
 *    e.g. a rowspanned member cell with per-period party rows) update the
 *    sitting member's party instead.
 *  - A trailing "Vacant" row, or a sole row whose note says the member left
 *    (elected to Lok/Rajya Sabha, resigned the seat, died, disqualified,
 *    expelled from the house), means the seat is VACANT - report no member
 *    rather than a stale one.
 *  - A later stray row re-linking the same constituency (e.g. a positions
 *    table) starts a new group, and the FIRST group wins - same guard the old
 *    keep-first dedup gave us.
 *  - Members are extracted from ref-stripped text (a <ref> cite's outlet link
 *    is not a person), and only from links AFTER the constituency link (a
 *    leading district-column link like [[Uttara Kannada]] is not a person).
 */

export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const stripRefs = (s: string) => s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '').replace(/\{\{efn[^}]*\}\}/gi, '');
const clean = (s: string) => stripRefs(s)
  .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '').replace(/'''?/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ').trim();
// Strip year-range tails ("(2022-present)", en/em dash variants) and org-role
// prefixes ("National Working President of ...") from a party candidate.
const normParty = (p: string) => clean(p)
  .replace(/\s*\((?:19|20)\d\d\s*[-–—]\s*(?:present|\d\d\d\d)\)\s*$/i, '')
  .replace(/^(?:national |state |working |general )*(?:president|vice[- ]president|secretary|convenor|convener|leader|chief) of (?:the )?/i, '')
  .trim();
// Cells split on newline-pipe AND same-line || / !! separators.
const cellsOf = (row: string) => ('\n' + row).split(/\n\s*[|!]\s?|\|\||!!/).map((c) => c.trim()).filter((c) => c.length);
const EXCLUDE = /(?:Assembly|Vidhan[a]? Sabha|Legislative) constituency|Lok Sabha| district\b|Party|File:|List of|Chief Minister|Speaker|Deputy Speaker|Governor|Casual vacancy|\.svg|\.png|\.jpg/i;
// Constituency wikilink in any spelling used across states - including the
// capital-C "(Vidhan Sabha) Constituency" (MH) and bare "(constituency)" (TN)
// variants; "(Lok Sabha constituency)" must NOT match.
const CONS_RE = /\[\[([^\]|]*?(?:(?:Assembly|Vidhan[a]? Sabha|Legislative Assembly)\)? constituency|\(\s*constituency\s*\))[^\]|]*?)(?:\|([^\]]+))?\]\]/i;
const CONS_COUNT_RE = /(?:(?:Assembly|Vidhan[a]? Sabha|Legislative Assembly)\)? constituency|\(\s*constituency\s*\))/gi;
const CONS_CELL_RE = /(?:Assembly|Vidhan[a]? Sabha|Legislative Assembly)\)? constituency|\(\s*constituency\s*\)/i;
const ALLIANCE_TAIL = /(?:Alliance|Coalition)$/i;
// Words that mark a wikilink as a political party (for states that link the party
// as a plain [[Party]] rather than a {{Party name with colour}} template, e.g. UP).
const PARTY_HINT = /\b(Party|Congress|Sena|Dal|Samajwadi|Bahujan|Janata|Communist|Morcha|Kazhagam|Rashtriya|Trinamool|Biju|Desam|Nationalist|People's|Democratic|Republican|Majlis|Jana Sena|Apna|Lok|Munnetra|Maha Vikas|Front|Samithi|Samiti)\b/i;
// A party value that is really a cell attribute, colour, or placeholder.
const BAD_PARTY = /^(?:rowspan|colspan|bgcolor|style|align|width|class|scope)\b|^(?:vacant|green|red|blue|white|black|grey|gray|orange|yellow|saffron|maroon|purple|pink|brown)$|=/i;
// A plain-text cell that is a status note, not a member name.
const NOTE_LEAD = /^(?:elected|re-?elected|suspended|joined|switched|defected|merged|re-?admitted|resigned|died|passed|expelled|disqualified|declared|appointed|became|nominated|sworn|by-?election|won|contested|supported|vacated|retained|on|in|since|from|after)\b/i;
// The reservation tail cell after a constituency link, e.g. "(SC)" / "(ST)".
const RESERVED_TAIL = /^\(?(?:SC|ST|SC\/ST)\)?$/i;
// A cell that reads "Vacant" (optionally with cell attributes before it or a
// "since <date>" tail after it) marks the seat vacant.
const VACANT_RE = /(?:^|\|\s*)vacant(?:\s+(?:since|from)\b[^|]*)?$/i;

/** Does this note mean the member in the row no longer holds the seat?
 *  Kept strict - a false positive silently vacates a seat, so "resigned as
 *  minister" / "suspended from the party" must NOT count. */
export function isDepartureNote(text: string): boolean {
  const t = clean(text);
  if (/elected to (?:the )?[^,;.\n]*?(?:lok|rajya) sabha|\bdied\b|passed away|\bdisqualified\b|\bexpelled from the (?:assembly|house)\b/i.test(t)) return true;
  const resign = t.match(/\bresign(?:ed|ation)\b\s*(?:(as|from)\s+([^,;.<\n]*))?/i);
  if (!resign) return false;
  if (!resign[1]) return true; // bare "Resigned on <date>" - the seat
  return /^(?:the\s+|his\s+|her\s+)?(?:office|assembly|seat|membership|house|mla)\b/i.test((resign[2] || '').trim());
}

export interface MLA { cons: string; name: string; title: string | null; party: string; note?: string; }
export interface Seat {
  cons: string;
  /** Sitting member, or null when the seat is vacant. */
  sitting: MLA | null;
  /** Members this group listed before the sitting one (departed incumbents). */
  departed: MLA[];
}

interface RowInfo { name: string | null; title: string | null; party: string | null; vacant: boolean; departedNote: boolean; note: string; }

/** Pick the section with the most Assembly-constituency links (the members table). */
function membersBody(wt: string): string {
  const parts = wt.split(/^==+\s*(.+?)\s*==+\s*$/m);
  if (parts.length < 3) return wt;
  let best = '';
  let bestN = 0;
  for (let i = 1; i < parts.length; i += 2) {
    if (/council/i.test(parts[i])) continue; // skip Legislative Council sections
    const body = parts[i + 1] || '';
    const n = (body.match(CONS_COUNT_RE) || []).length;
    if (n > bestN) { bestN = n; best = body; }
  }
  return best || wt;
}

/** Party from one cell: template params first (skipping attr params like
 *  rowspan=3), then a plain [[Party]] link. Null if the cell has neither. */
function partyFromCell(cell: string): string | null {
  for (const tm of cell.matchAll(/\{\{\s*(?:Full party name with colou?r|[Pp]arty name with colou?r|[Pp]arty color(?: cell)?)\s*((?:\|[^|{}]*)+)\}\}/g)) {
    const params = tm[1].split('|').map((s) => s.trim()).filter(Boolean).filter((p) => !/^\w+\s*=/.test(p));
    if (params.length) {
      const v = normParty(params[0]);
      if (v && v.length >= 2 && !ALLIANCE_TAIL.test(v) && !BAD_PARTY.test(v)) return v;
    }
  }
  for (const lm of cell.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g)) {
    const disp = clean(lm[2] || lm[1]);
    if (PARTY_HINT.test(lm[1]) && !ALLIANCE_TAIL.test(disp) && !/constituency|district|Lok Sabha|List of/i.test(lm[1])) {
      const v = normParty(lm[2] || lm[1]);
      if (v && v.length >= 2 && !BAD_PARTY.test(v)) return v;
    }
  }
  return null;
}

function parseRow(rawRow: string, isConsRow: boolean): RowInfo {
  const row = stripRefs(rawRow); // a <ref>'s outlet/link must never become a name or party
  const consM = isConsRow ? row.match(CONS_RE) : null;
  // Member/party live AFTER the constituency cell; leading district/number
  // cells (e.g. a [[Uttara Kannada]] district link) are not candidates.
  const scanFrom = consM ? (consM.index! + consM[0].length) : 0;
  const scan = row.slice(scanFrom);

  // Party: first party-bearing cell left-to-right (the party column precedes
  // the alliance column); whole-scan fallback for multi-line templates.
  let party: string | null = null;
  for (const c of cellsOf(scan)) { party = partyFromCell(c); if (party) break; }
  if (!party) party = partyFromCell(scan);

  // Member = first person wikilink after the constituency cell.
  let title: string | null = null;
  let name: string | null = null;
  for (const lm of scan.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g)) {
    if (EXCLUDE.test(lm[1]) || PARTY_HINT.test(lm[1])) continue;
    title = lm[1].trim().replace(/_/g, ' ');
    name = clean(lm[2] || lm[1]);
    break;
  }
  const cells = cellsOf(scan);
  if (!name) {
    // Plain-text member: the first substantive cell after the constituency
    // (member column leads); reject party names, notes, attribute junk.
    for (const c of cells) {
      if (/\{\{/.test(c)) continue;
      const v = clean(c);
      if (!v) continue;
      if (/=/.test(v)) continue; // leftover cell attributes
      if (RESERVED_TAIL.test(v)) continue; // "(SC)"/"(ST)" tail after the constituency
      if (!/^[A-Za-z]/.test(v) || v.length > 50) break; // numbers/dates/long text - not a name column
      if (VACANT_RE.test(v)) break; // vacancy handled below
      if (PARTY_HINT.test(v) || NOTE_LEAD.test(v)) break; // party or status note - no member in this row
      name = v;
      break;
    }
  }
  const vacant = cells.some((c) => VACANT_RE.test(clean(c)));
  if (name && (VACANT_RE.test(name) || vacant)) name = null; // a Vacant row names nobody
  const cleaned = clean(row);
  const noteM = cleaned.match(/(?:Elected|Re-?elected|Resigned|Died|Passed away|Disqualified|Expelled|Suspended)[^|]*/i);
  return {
    name: name && name.length >= 2 ? name : null,
    title,
    party,
    vacant,
    departedNote: isDepartureNote(cleaned),
    note: noteM ? noteM[0].trim() : '',
  };
}

/** Seat-number/constituency cell rowspan. Only the LAST TWO cells before the
 *  constituency link count (seat number + constituency attrs): an earlier
 *  district cell's rowspan spans a district block, not this seat, and a
 *  rowspan inside a later party template is not a seat span either. */
function seatRowspan(row: string): number {
  const consM = row.match(CONS_RE);
  if (!consM) return 1;
  const segs = row.slice(0, consM.index!).split(/\n\s*\||\|\|/);
  let n = 1;
  for (const seg of segs.slice(-2)) {
    for (const m of seg.matchAll(/rowspan\s*=\s*"?(\d+)/gi)) n = Math.max(n, parseInt(m[1], 10));
  }
  return n;
}

/** Every seat in the roster, including vacant ones. */
export function parseSeats(wt: string): Seat[] {
  const body = membersBody(wt);
  const rows = body.split(/\n\|-/);
  const groups: { cons: string; rows: string[] }[] = [];
  let cur: { cons: string; rows: string[] } | null = null;
  let pending = 0;
  for (const row of rows) {
    const consM = stripRefs(row).match(CONS_RE);
    if (consM) {
      // Constituency wikilink (any spelling). Prefer the link's display text; else
      // derive it by stripping the "…(Assembly|Vidhan Sabha) constituency" tail.
      const cons = (consM[2] ? clean(consM[2]) : clean(consM[1]
        .replace(/\s*\(?[A-Za-z. ]*?(?:Assembly|Vidhan[a]? Sabha|Legislative Assembly)\)? constituency\)?/i, '')
        .replace(/\s*\(\s*constituency\s*\)/i, '')))
        .replace(/\s*\((SC|ST|SC\/ST)\)\s*$/i, '').trim();
      if (!cons) { cur = null; pending = 0; continue; }
      cur = { cons, rows: [stripRefs(row)] };
      groups.push(cur);
      pending = seatRowspan(stripRefs(row)) - 1;
    } else if (pending > 0 && cur) {
      cur.rows.push(stripRefs(row));
      pending--;
    } else {
      cur = null;
      pending = 0;
    }
  }

  // First group per constituency wins (stray later rows can't override), then
  // within the group the last member row is the sitting member.
  const seen = new Set<string>();
  const seats: Seat[] = [];
  let curParty = ''; // party carries across rows for tables that rowspan the party cell
  for (const g of groups) {
    const infos = g.rows.map((r, i) => parseRow(r, i === 0));
    const k = slug(g.cons);
    if (seen.has(k)) continue;
    seen.add(k);
    let sitting: RowInfo | null = null;
    let sittingIdx = -1;
    for (let i = 0; i < infos.length; i++) {
      const inf = infos[i];
      if (inf.party) curParty = inf.party;
      if (inf.vacant && !inf.name) { sitting = null; sittingIdx = -1; continue; }
      if (inf.name) { sitting = inf; sittingIdx = i; }
    }
    // The sitting candidate's own row says the member left, and no later row
    // names a successor - the seat is vacant, not stale.
    if (sitting && sitting.departedNote && sittingIdx === infos.length - 1) sitting = null;
    // Party-history continuation rows (member cell rowspanned): the LAST party
    // listed at/after the sitting row is the current one.
    let sittingParty = '';
    if (sitting) {
      for (let i = sittingIdx; i < infos.length; i++) if (infos[i].party) sittingParty = infos[i].party!;
      if (!sittingParty) sittingParty = curParty;
    }
    const departed: MLA[] = [];
    for (const inf of infos) {
      if (inf === sitting || !inf.name) continue;
      departed.push({ cons: g.cons, name: inf.name, title: inf.title, party: inf.party || curParty || 'Independent' });
    }
    seats.push({
      cons: g.cons,
      sitting: sitting && sitting.name
        ? { cons: g.cons, name: sitting.name, title: sitting.title, party: sittingParty || 'Independent', ...(sitting.note ? { note: sitting.note } : {}) }
        : null,
      departed,
    });
  }
  return seats;
}

/** Sitting members only - what the roster importer writes to the seed. The
 *  note (e.g. "Elected on 23 November 2024") is kept only when a departed
 *  incumbent preceded the sitting member, i.e. it describes a by-election. */
export function parseMembers(wt: string): MLA[] {
  return parseSeats(wt).filter((s) => s.sitting).map((s) => {
    const m = s.sitting!;
    if (!s.departed.length && m.note) { const { note: _note, ...rest } = m; return rest; }
    return m;
  });
}
