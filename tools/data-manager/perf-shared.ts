/**
 * Shared logic for the parliamentary-performance pipeline (enrich-performance
 * writes, verify-attendance re-derives and compares). Both steps MUST agree on
 * the semantics below, so they live in one place.
 *
 * == Lok Sabha attendance register codes (api_ls/member/getMemberAttendanceByMpsno) ==
 * Each session returns date-groups keyed by attendanceType:
 *   S, S*, S#   signed the register that day            -> present
 *   NS, NS@     did not sign                            -> absent
 *   NR          NO RECORD kept for that member that day -> excluded entirely
 * "NR" is how the house marks members who are exempt from signing: every day of
 * every session is NR for Council of Ministers members, the Speaker, and the
 * Leader of the Opposition (Cabinet rank). Counting NR days as "absent" is what
 * once gave the Prime Minister a published attendance of 0% - a wrong and
 * defamatory-by-implication claim. So:
 *
 *   attendance_pct = signed / (signed + notSigned)   over RECORDED days only
 *   - needs >= MIN_RECORDED_DAYS recorded days, else no value (missing);
 *   - a member whose days are majority-NR has no usable register record at all
 *     -> metric stays ABSENT and is marked exempt (never 0).
 *
 * == Rajya Sabha (integration.rajyasabha.digital memberattendance) ==
 * Per-session rows carry noofsittings as a NUMBER of days present - except for
 * ministers, whose rows carry the literal marker "M" (exempt from the register).
 * A numeric 0 is a real zero; "M" is an exemption; a missing row means the
 * person was not a member that session (excluded from the denominator).
 *
 * == Questions ==
 * Ministers answer questions, they do not table them, so a count of 0 for a
 * minister is an artifact of the exemption -> marked exempt, never stored as 0.
 * A 0 for a private member is a real, citable zero and IS stored.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Politician, Fact, PerfMetric, MetricExemptReason } from '../../lib/types';

export const UA = 'RankYourPolitician-DataManager/1.0 (civic info; vikas070696@gmail.com)';
// Public token sansad.in's own frontend ships for the RS attendance service.
export const RS_BEARER = 'Y0hKaFltaGhkQzVyYVhKaGJn';
/** A percentage needs a meaningful base of recorded sitting days. */
export const MIN_RECORDED_DAYS = 20;

export const PERF_FIELDS: PerfMetric[] = ['attendance_pct', 'questions_asked', 'debates_participated'];

const SHARED_ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

/**
 * Presiding officers neither sign the register nor table questions, and their
 * "debate participation" counts every sitting they chaired (the Speaker once
 * showed 368 "debates"), so all three metrics are exemptions, not zeros.
 * The Speaker/Deputy Speaker come from the maintained constitutional-offices
 * seed; the RS Deputy Chairperson is resolved live from the official API.
 * (The two LoP entries in that file are NOT presiding officers - their register
 * exemption is detected from the data itself via the majority-NR rule.)
 */
export const LS_PRESIDING_IDS: Set<string> = (() => {
  try {
    const offices: any[] = JSON.parse(readFileSync(resolve(SHARED_ROOT, 'data', 'seed', 'constitutional_offices.json'), 'utf8'));
    return new Set(
      offices
        .filter((o) => (o.office === 'ls_speaker' || o.office === 'ls_deputy_speaker') && o.politicianId)
        .map((o) => o.politicianId as string),
    );
  } catch {
    return new Set<string>();
  }
})();

/**
 * Last-resort join table for LS members whose sansad.in spelling differs too
 * much for fuzzy matching (our id -> sansad member name as returned by the
 * member API). Each entry was verified against the member's constituency on
 * sansad.in before being added - the seat must ALSO match for an alias to bind.
 */
export const LS_NAME_ALIASES: Record<string, string> = {
  'purnia-pappu-yadav': 'Rajesh Ranjan', // known as Pappu Yadav; sansad lists the legal name
  'siwan-vijay-lakshmi-kushwaha': 'Vijaylakshmi Devi',
  'ramanathapuram-navas-kani': 'Navaskani K',
  'viluppuram-durai-ravikumar': 'D Ravi Kumar',
  'dindigul-r-sachidanandam': 'Sachithanantham R',
  'nagina-chandrashekhar-azad': 'Chandra Shekhar',
};

export async function getJson(u: string, headers: Record<string, string> = {}): Promise<any | null> {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
      if (r.ok) return await r.json();
      if (r.status === 400 || r.status === 404) return null;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 700 * (a + 1)));
  }
  return null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const norm = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bnct of\b/g, '').replace(/\((?:sc|st)\)/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');

export function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export const tokens = (s: string) =>
  new Set((s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(dr|adv|shri|smt|kumari|prof|er|md|mohd|col|thiru|alias)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t.length > 1));

/**
 * Token overlap in [0,1]. Tokens count as equal when identical, one edit apart
 * (>= 4 chars: Saugata/Sougata), or when one is a concatenation of the other's
 * neighbours (Chandrashekhar vs Chandra Shekhar is handled by the caller via
 * concatenated comparison).
 */
export function nameOverlap(a: string, b: string): number {
  const ta = [...tokens(a)], tb = [...tokens(b)];
  if (!ta.length || !tb.length) return 0;
  let i = 0;
  for (const t of ta) {
    if (tb.some((u) => u === t || (t.length >= 4 && u.length >= 4 && lev(t, u) <= 1))) i++;
  }
  return i / Math.min(ta.length, tb.length);
}

/** Whole-name comparison that survives token splits ("Chandra Shekhar" vs
 *  "Chandrashekhar") and word-order swaps ("Babu Rao Golla" vs "Golla Baburao"):
 *  compare the concatenation both in display order and alphabetically sorted. */
export function sameCompactName(a: string, b: string): boolean {
  const ta = [...tokens(a)], tb = [...tokens(b)];
  const cmp = (x: string, y: string) => !!x && !!y && (x === y || (x.length >= 8 && y.length >= 8 && lev(x, y) <= 2));
  return (
    cmp(ta.join(''), tb.join('')) ||
    cmp([...ta].sort().join(''), [...tb].sort().join(''))
  );
}

// ---------------------------------------------------------------- Lok Sabha

export interface LsMember { mpsno: number; name: string; cons: string; state: string }

export async function fetchLsMembers(): Promise<LsMember[]> {
  const ml = await getJson('https://sansad.in/api_ls/member?loksabha=18&page=1&size=600&sitting=1&locale=en');
  const raw: any[] = ml?.membersDtoList || [];
  return raw
    .map((m) => ({ mpsno: m.mpsno, name: [m.firstName, m.lastName].filter(Boolean).join(' '), cons: m.constName || '', state: m.stateName || '' }))
    .filter((m) => m.mpsno);
}

export async function fetchLsSessions(): Promise<number[]> {
  const sess = await getJson('https://sansad.in/api_ls/business/getAllLoksabhaAndSession');
  const out: number[] = [];
  if (Array.isArray(sess)) {
    for (const row of sess) {
      if (String(row.loksabha ?? row.lkNo ?? row.loksabhaNo) !== '18') continue;
      const list = row.sessionList || row.sessions || row.session || [];
      for (const s of Array.isArray(list) ? list : [list]) {
        const n = parseInt(String(s.sessionNo ?? s.session ?? s), 10);
        if (Number.isFinite(n)) out.push(n);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export interface LsAttendanceCounts { signed: number; notSigned: number; noRecord: number; other: number }

/** Aggregate one member's register days across sessions, split by code class. */
export async function fetchLsAttendanceCounts(mpsno: number, sessions: number[]): Promise<LsAttendanceCounts> {
  const c: LsAttendanceCounts = { signed: 0, notSigned: 0, noRecord: 0, other: 0 };
  for (const s of sessions) {
    const att = await getJson(`https://sansad.in/api_ls/member/getMemberAttendanceByMpsno?loksabha=18&session=${s}&mpsno=${mpsno}`);
    const groups: any[] = Array.isArray(att) ? att : att?.records || [];
    for (const g of groups) {
      const n = (g.dates || []).length;
      if (!n) continue;
      const t = String(g.attendanceType || '').toUpperCase();
      if (t.startsWith('NR')) c.noRecord += n;
      else if (t.startsWith('NS')) c.notSigned += n;
      else if (t.startsWith('S')) c.signed += n;
      else c.other += n;
    }
    await sleep(120);
  }
  return c;
}

export type AttendanceOutcome =
  | { kind: 'value'; pct: number; signed: number; recorded: number }
  | { kind: 'no-record' } // register effectively not kept for this member
  | { kind: 'insufficient' }; // too few recorded days to state a percentage

export function classifyLsAttendance(c: LsAttendanceCounts): AttendanceOutcome {
  const recorded = c.signed + c.notSigned;
  const total = recorded + c.noRecord;
  // Majority-NR means the house does not keep this member's register (minister,
  // presiding officer, LoP). A stale partial window would misstate their record.
  if (total > 0 && c.noRecord > recorded) return { kind: 'no-record' };
  if (recorded >= MIN_RECORDED_DAYS) {
    const pct = Math.round((c.signed / recorded) * 1000) / 10;
    return { kind: 'value', pct, signed: c.signed, recorded };
  }
  return { kind: 'insufficient' };
}

export async function fetchLsQuestionCount(mpsno: number): Promise<number | null> {
  const q = await getJson(`https://sansad.in/api_ls/question/qetFilteredQuestionsAns?loksabhaNo=18&memberCode=${mpsno}&pageNo=1&pageSize=1&locale=en`);
  const qo = Array.isArray(q) ? q[0] : q;
  const n = qo?.totalRecordSize ?? qo?.totalRecords ?? null;
  return typeof n === 'number' ? n : null;
}

export async function fetchLsDebateCount(mpsno: number): Promise<number | null> {
  const d = await getJson(`https://sansad.in/api_ls/debate/participation?mpsno=${mpsno}&loksabha=18&house=LS`);
  const n = d?.participation ?? null;
  return typeof n === 'number' ? n : null;
}

/**
 * Seat-first matching of sansad LS members to our seed (one member per seat).
 *
 * Two passes: exact name equality binds first, fuzzy second. The order matters
 * because the sitting list can carry a STALE DUPLICATE row for a seat - Nanded
 * 2024 listed both the late Vasantrao Chavan and his by-election successor
 * Ravindra Vasantrao Chavan, and a fuzzy first pass bound the seat to the late
 * father's row (surnames overlap), attributing a dead man's attendance to the
 * sitting member.
 */
export function matchLsMembers(ourLs: Politician[], members: LsMember[]): { pairs: { p: Politician; m: LsMember }[]; unmatched: string[] } {
  const byConsState = new Map<string, Politician>();
  for (const p of ourLs) byConsState.set(norm(p.constituencyName) + '|' + norm(p.state), p);
  const pairs: { p: Politician; m: LsMember }[] = [];
  const unmatched: string[] = [];
  const taken = new Set<string>();
  const exactName = (p: Politician, m: LsMember) => {
    const ta = [...tokens(p.name)].sort().join('|');
    const tb = [...tokens(m.name)].sort().join('|');
    return (ta.length > 0 && ta === tb) || norm(LS_NAME_ALIASES[p.id] || '') === norm(m.name);
  };

  const pass2: LsMember[] = [];
  for (const m of members) {
    const p = byConsState.get(norm(m.cons) + '|' + norm(m.state));
    if (p && !taken.has(p.id) && exactName(p, m)) { pairs.push({ p, m }); taken.add(p.id); }
    else pass2.push(m);
  }

  for (const m of pass2) {
    let p = byConsState.get(norm(m.cons) + '|' + norm(m.state));
    if (p && taken.has(p.id)) { unmatched.push(`${m.name} @ ${m.cons} (seat already matched exactly - stale duplicate row?)`); continue; }
    if (!p) {
      // Transliteration fallback: unique same-state seat within edit distance 2
      // whose member name also agrees (Purnia/Purnea, Kodarma/Koderma).
      const cands = ourLs.filter(
        (x) => !taken.has(x.id) && norm(x.state) === norm(m.state) && lev(norm(x.constituencyName), norm(m.cons)) <= 2 && (nameOverlap(x.name, m.name) >= 0.5 || sameCompactName(x.name, m.name)),
      );
      if (cands.length === 1) p = cands[0];
    }
    const nameOk = p && (nameOverlap(p.name, m.name) >= 0.5 || sameCompactName(p.name, m.name) || tokens(m.name).size === 0);
    if (p && nameOk && !taken.has(p.id)) { pairs.push({ p, m }); taken.add(p.id); }
    else if (p) unmatched.push(`${m.name} vs ${p.name} @ ${m.cons} (name mismatch)`);
    else unmatched.push(`${m.name} @ ${m.cons}, ${m.state} (no seat match)`);
  }
  return { pairs, unmatched };
}

// -------------------------------------------------------------- Rajya Sabha

export interface RsSitting {
  mpsno: number;
  name: string; // display-ordered full name, honorifics stripped
  state: string;
  currentMinister: boolean;
  notificationDate?: string; // dd/mm/yyyy - start of the current term
}

export async function fetchRsSitting(): Promise<RsSitting[]> {
  const rl = await getJson('https://sansad.in/api_rs/member/sitting-members?state=&party=&gender=&page=1&size=300&mpFlag=1&locale=en');
  const recs: any[] = rl?.records || [];
  return recs
    .map((r) => {
      const first = String(r.firstName || '').trim();
      const last = String(r.lastName || '').trim();
      // name field is "Last, Honorific First ..."; first/last are cleaner but
      // occasionally first is blank and last holds the whole name.
      const name = (first ? `${first} ${last}` : last).trim();
      return {
        mpsno: parseInt(String(r.mpsno ?? 0), 10),
        name,
        state: String(r.state || '').trim(),
        currentMinister: !!r.currentMinister,
        notificationDate: r.notificationDate || undefined,
      };
    })
    .filter((r) => r.mpsno && r.name);
}

export interface RsSession { no: number; sittings: number }

/** Most recent completed RS sessions (default 6), oldest first. */
export async function fetchRsSessions(count = 6): Promise<RsSession[]> {
  const sl = await getJson('https://integration.rajyasabha.digital/api-ext/api/v1/attendance/sessionlist', { Authorization: `Bearer ${RS_BEARER}` });
  const now = Date.now();
  return (Array.isArray(sl) ? sl : sl?.records || [])
    .filter((s: any) => s.period2 && new Date(s.period2).getTime() < now)
    .map((s: any) => ({ no: parseInt(String(s.sessionno), 10), sittings: parseInt(String(s.noofsittings ?? 0), 10) }))
    .filter((s: RsSession) => Number.isFinite(s.no) && s.sittings > 0)
    .sort((a: RsSession, b: RsSession) => b.no - a.no)
    .slice(0, count)
    .reverse();
}

export interface RsAttendanceAgg {
  present: number; // days present across sessions with a numeric record
  eligible: number; // sitting days of those sessions
  markerSessions: number; // sessions where the row carries an exemption marker
  markers: string[]; // distinct markers seen: "M" (Minister), "LOP", "HDC"
  sessions: number; // sessions where the member has any row
}

/**
 * Aggregate per-member attendance across the window. One API call per session
 * for the whole house. Numeric noofsittings (0 included) is a real count; the
 * official record marks exempt members with a letter code instead of a number:
 * "M" (Council of Ministers), "LOP" (Leader of the Opposition, Cabinet rank),
 * "HDC" (Hon'ble Deputy Chairman - presides).
 */
export async function fetchRsAttendance(sessions: RsSession[]): Promise<Map<number, RsAttendanceAgg>> {
  const agg = new Map<number, RsAttendanceAgg>();
  for (const s of sessions) {
    const att = await getJson(`https://integration.rajyasabha.digital/api-ext/api/v1/attendance/memberattendance?session=${s.no}`, { Authorization: `Bearer ${RS_BEARER}` });
    const rows: any[] = Array.isArray(att) ? att : att?.records || [];
    for (const r of rows) {
      const id = parseInt(String(r.mpsno ?? r.mpcode ?? 0), 10);
      if (!id) continue;
      const a = agg.get(id) || { present: 0, eligible: 0, markerSessions: 0, markers: [], sessions: 0 };
      a.sessions++;
      const raw = String(r.noofsittings ?? '').trim();
      if (/^\d+$/.test(raw)) {
        const n = parseInt(raw, 10);
        a.present += Math.min(n, s.sittings);
        a.eligible += s.sittings;
      } else if (raw) {
        a.markerSessions++;
        const mk = raw.toUpperCase();
        if (!a.markers.includes(mk)) a.markers.push(mk);
      }
      agg.set(id, a);
    }
    await sleep(200);
  }
  return agg;
}

export function classifyRsAttendance(a: RsAttendanceAgg | undefined): AttendanceOutcome {
  if (!a || a.sessions === 0) return { kind: 'insufficient' }; // no row -> not a member in the window
  // Majority-marker mirrors the LS majority-NR rule: the register is effectively
  // not kept for this member, so a stale pre-appointment window must not be
  // presented as their attendance.
  const numericSessions = a.sessions - a.markerSessions;
  if (a.markerSessions > numericSessions) return { kind: 'no-record' };
  if (a.eligible >= MIN_RECORDED_DAYS) {
    const pct = Math.round((a.present / a.eligible) * 1000) / 10;
    return { kind: 'value', pct, signed: a.present, recorded: a.eligible };
  }
  return { kind: 'insufficient' };
}

/** Exemption reason + cited wording for a no-record RS member, from the marker
 *  the official record itself uses. */
export function rsNoRecordExemption(a: RsAttendanceAgg | undefined): { reason: MetricExemptReason; factValue: string } {
  const markers = a?.markers ?? [];
  if (markers.includes('HDC'))
    return { reason: 'presiding-officer', factValue: 'No register record - marked "HDC" (Hon\'ble Deputy Chairman, presides over the House) in the official attendance record' };
  if (markers.includes('LOP'))
    return { reason: 'no-register-record', factValue: 'No register record - marked "LOP" (Leader of the Opposition, holds Cabinet rank) in the official attendance record' };
  return { reason: 'minister', factValue: 'No register record - marked "M" (Minister) in the official attendance record' };
}

/**
 * Member-wise question count from the official RS question store (the same
 * backend sansad.in's Q&A search uses). Counts distinct tabled questions in the
 * session window.
 */
export async function fetchRsQuestionCount(mpsno: number, sesFrom: number, sesTo: number): Promise<number | null> {
  const where = sesFrom === sesTo ? `ses_no=${sesFrom} and mp_code='${mpsno}'` : `ses_no>=${sesFrom} and ses_no<=${sesTo} and mp_code='${mpsno}'`;
  const rows = await getJson(`https://rsdoc.nic.in/Question/Search_Questions?whereclause=${encodeURIComponent(where)}`);
  if (!Array.isArray(rows)) return null;
  // The store returns one row per question-member pairing; count distinct
  // session+number so a question with supplementaries is not double-counted.
  const seen = new Set<string>();
  for (const r of rows) seen.add(`${r.ses_no}|${r.qno}|${r.qtype}`);
  return seen.size;
}

/** RS Deputy Chairperson (presides; exempt by convention). Best-effort lookup. */
export async function fetchRsDeputyChairMpsno(): Promise<number | null> {
  const d = await getJson('https://rsdoc.nic.in/memberGetdata/GetDeputyChairman');
  const row = Array.isArray(d) ? d[0] : d?.records?.[0] ?? d;
  const n = parseInt(String(row?.mpsno ?? row?.mpcode ?? row?.mp_code ?? 0), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Verified RS join table (our id -> the name the sitting-members API returns).
 * Every entry was verified before being added: state and party agree, the pair
 * is the ONLY leftover on both sides for that state after fuzzy matching, and
 * where a birth date exists it matches (Aditya Sahu = "Aditya Prasad",
 * dob 07/10/1963 on both sides).
 *
 * Deliberately NOT aliased, because "missing beats wrong":
 *  - "Rukmini Mallik" (AITC, WB 2026-32) vs our Koel Mallick (Independent) -
 *    party conflicts and WB has several unmatched seed records.
 *  - "K. Vanlalvena" (MNF, term ending 2026) vs our K. Laltluangkima (ZPM) -
 *    different people; the sitting list still carries the outgoing member.
 */
export const RS_NAME_ALIASES: Record<string, string> = {
  'laxmikant-bajpai-rs-up': 'Laxmikant Bajpayee',
  'ashok-chavan-rs-mh': 'Ashokrao Shankarrao Chavan',
  'govind-dholakia-rs-gj': 'Govindbhai Laljibhai Dholakia',
  'geeta-shakya-rs-up': 'Geeta alias Chandraprabha',
  'ajit-gopchade-rs-mh': 'Ajeet Madhavrao Gopchade',
  'christopher-tilak-rs-tn': 'Christopher Manickam',
  'mayankbhai-nayak-rs-gj': 'Mayankkumar Nayak',
  'sharad-pawar-rs-mh': 'Sharadchandra Pawar',
  'aditya-sahu-rs-jh': 'Aditya Prasad',
  'ramji-gautam-rs-up': 'Ramji',
  'rajubhai-shukla-rs-gj': 'Rajesh Parmanand Shukla',
  'alka-gurjar-rs-rj': 'Alka Singh',
  'umesh-nath-maharaj-rs-mp': 'Balyogi Umeshnath',
  'vaddiraju-ravichandra-rs-tg': 'Ravi Chandra Vaddiraju',
};

/** Name+state matching of RS sitting members to our seed records. */
export function matchRsMembers(ourRs: Politician[], sitting: RsSitting[]): { pairs: { p: Politician; m: RsSitting }[]; unmatched: string[] } {
  const pairs: { p: Politician; m: RsSitting }[] = [];
  const unmatched: string[] = [];
  const taken = new Set<string>();
  const aliasByName = new Map(Object.entries(RS_NAME_ALIASES).map(([id, n]) => [norm(n), id]));
  const byId = new Map(ourRs.map((p) => [p.id, p]));
  for (const m of sitting) {
    const aliasId = aliasByName.get(norm(m.name));
    if (aliasId) {
      const p = byId.get(aliasId);
      if (p && !taken.has(p.id)) { pairs.push({ p, m }); taken.add(p.id); continue; }
    }
    const sameState = (p: Politician) =>
      !m.state || norm(p.state) === norm(m.state) || norm(p.constituencyName).includes(norm(m.state));
    let cands = ourRs.filter((p) => !taken.has(p.id) && sameState(p) && (nameOverlap(p.name, m.name) >= 0.65 || sameCompactName(p.name, m.name)));
    if (cands.length !== 1) {
      // Unique strong name match across all RS seats (state strings sometimes
      // disagree: "Nominated", NCT spellings, seat swaps mid-term).
      const strong = ourRs.filter((p) => !taken.has(p.id) && (nameOverlap(p.name, m.name) >= 0.85 || sameCompactName(p.name, m.name)));
      if (strong.length === 1) cands = strong;
    }
    if (cands.length === 1) { pairs.push({ p: cands[0], m }); taken.add(cands[0].id); }
    else unmatched.push(`${m.name} (${m.state})${cands.length > 1 ? ' [ambiguous]' : ''}`);
  }
  return { pairs, unmatched };
}

// ------------------------------------------------------- seed write helpers

/**
 * writeFileSync with retries: on Windows a concurrent reader (dev server,
 * antivirus scan) intermittently fails the open with errno -4094, which used
 * to kill an hour-long enrich run at a checkpoint. Retries with a short pause;
 * as a last resort a checkpoint is skippable (state persists in memory until
 * the next write), so `required=false` swallows the final failure.
 */
export async function saveSeedWithRetry(path: string, data: unknown, required = true): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  let lastErr: unknown;
  for (let a = 0; a < 5; a++) {
    try {
      writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
      return;
    } catch (e) {
      lastErr = e;
      await sleep(300 * (a + 1));
    }
  }
  if (required) throw lastErr;
  console.warn(`  (checkpoint write skipped after retries: ${String(lastErr).slice(0, 80)})`);
}

/** Strip the three core perf metrics, their facts, and exemption markers. */
export function clearPerf(p: Politician) {
  for (const f of PERF_FIELDS) {
    delete (p.metrics as Record<string, number | undefined>)[f];
    if (p.metrics_exempt) delete p.metrics_exempt[f];
  }
  if (p.metrics_exempt && Object.keys(p.metrics_exempt).length === 0) delete p.metrics_exempt;
  p.facts = p.facts.filter((f) => !PERF_FIELDS.includes(f.field_type as PerfMetric));
}

export function setMetric(p: Politician, field: PerfMetric, value: number, fact: Omit<Fact, 'field_type'>) {
  p.metrics[field] = value;
  if (p.metrics_exempt) delete p.metrics_exempt[field];
  p.facts = p.facts.filter((f) => f.field_type !== field);
  p.facts.push({ field_type: field, ...fact });
}

export function setExempt(p: Politician, field: PerfMetric, reason: MetricExemptReason, fact: Omit<Fact, 'field_type'>) {
  delete (p.metrics as Record<string, number | undefined>)[field];
  p.metrics_exempt = p.metrics_exempt || {};
  p.metrics_exempt[field] = reason;
  p.facts = p.facts.filter((f) => f.field_type !== field);
  p.facts.push({ field_type: field, ...fact });
}
