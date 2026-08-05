// Shared data-manager logic: read the local seed, validate it, and publish to
// Firestore with the Admin SDK. This runs ONLY on your machine, using a
// service-account key that never leaves it. Never imported by the deployed site.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Politician, Constituency, Fact, CriminalRecord, ElectionEvent, Minister, StateGovernment, LegislatureTermsFile, SeatVacancy } from '../../lib/types';

export const ROOT = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  '..',
);
const SEED_DIR = resolve(ROOT, 'data', 'seed');

export function loadSeed(): { politicians: Politician[]; constituencies: Constituency[] } {
  return {
    politicians: JSON.parse(readFileSync(resolve(SEED_DIR, 'politicians.json'), 'utf8')),
    constituencies: JSON.parse(readFileSync(resolve(SEED_DIR, 'constituencies.json'), 'utf8')),
  };
}

export function savePoliticians(politicians: Politician[]) {
  writeFileSync(resolve(SEED_DIR, 'politicians.json'), JSON.stringify(politicians, null, 2) + '\n');
}

export interface Issue {
  politicianId: string;
  name: string;
  severity: 'error' | 'warn';
  message: string;
}

export function validateDataset(): { issues: Issue[]; ok: boolean } {
  const { politicians, constituencies } = loadSeed();
  const consIds = new Set(constituencies.map((c) => c.id));
  const issues: Issue[] = [];
  const push = (p: Politician, severity: Issue['severity'], message: string) =>
    issues.push({ politicianId: p.id, name: p.name, severity, message });

  const termsPath = resolve(SEED_DIR, 'legislature_terms.json');
  const terms = JSON.parse(readFileSync(termsPath, 'utf8')) as LegislatureTermsFile;
  const termRecord = { id: 'legislature-terms', name: 'Legislature terms' } as Politician;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!terms.source_url || !terms.source_name || !terms.retrieved_date) {
    push(termRecord, 'error', 'legislature_terms.json has no complete source citation');
  }
  const assemblyCodes = new Set<string>();
  for (const term of terms.assemblies) {
    if (assemblyCodes.has(term.stateCode)) push(termRecord, 'error', `duplicate Assembly term for ${term.stateCode}`);
    assemblyCodes.add(term.stateCode);
    if (!isoDate.test(term.from) || !isoDate.test(term.to) || term.from >= term.to) {
      push(termRecord, 'error', `invalid Assembly term dates for ${term.stateCode}: ${term.from} to ${term.to}`);
    }
  }

  // ---- Seat vacancies ------------------------------------------------------
  // The reason a constituency has no member is a published claim like any other,
  // so it is held to the same rule: cited, pointed at a real seat, and never
  // shown beside a sitting member (which would be flatly contradictory).
  const vacanciesPath = resolve(SEED_DIR, 'vacancies.json');
  if (existsSync(vacanciesPath)) {
    const vacancies = JSON.parse(readFileSync(vacanciesPath, 'utf8')) as SeatVacancy[];
    const vacancyRecord = { id: 'vacancies', name: 'Seat vacancies' } as Politician;
    const held = new Set(politicians.filter((p) => p.active !== false).map((p) => p.constituencyId));
    const seenVacancy = new Set<string>();
    for (const v of vacancies) {
      const where = v.constituencyId || '(no constituencyId)';
      if (seenVacancy.has(v.constituencyId)) push(vacancyRecord, 'error', `duplicate vacancy record for ${where}`);
      seenVacancy.add(v.constituencyId);
      if (!consIds.has(v.constituencyId)) push(vacancyRecord, 'error', `vacancy ${where} is not a constituency`);
      if (!v.value?.trim()) push(vacancyRecord, 'error', `vacancy ${where} has no statement`);
      if (!v.source_url || !v.source_name || !v.retrieved_date) {
        push(vacancyRecord, 'error', `vacancy ${where} has no complete citation (no citation, no claim)`);
      }
      if (v.retrieved_date && !isoDate.test(v.retrieved_date)) push(vacancyRecord, 'error', `vacancy ${where} retrieved_date must be ISO yyyy-mm-dd`);
      if (v.as_of !== undefined && !isoDate.test(v.as_of)) push(vacancyRecord, 'error', `vacancy ${where} as_of must be ISO yyyy-mm-dd`);
      // The page hides the note when a member exists, so this never reaches a
      // reader - but a contradiction in the seed means one of the two is stale.
      if (held.has(v.constituencyId)) push(vacancyRecord, 'error', `vacancy ${where} contradicts a sitting member in politicians.json`);
    }
    // The other direction is a warning, not an error: an unexplained empty seat
    // is the dead end this file exists to remove, but shipping is not blocked on
    // research we have not done yet.
    for (const c of constituencies) {
      if (c.type !== 'AC' && c.type !== 'PC') continue;
      if (held.has(c.id) || seenVacancy.has(c.id)) continue;
      push(vacancyRecord, 'warn', `${c.id} (${c.name}, ${c.state}) has no sitting member and no cited reason - /area shows a dead end`);
    }
  }

  for (const p of politicians) {
    // Upper-house members (Rajya Sabha MPs, and MLCs in the Legislative Council)
    // are indirectly elected/nominated with NO territorial constituency, so an
    // empty constituencyId (and no districts) is correct for them.
    const upperHouse =
      p.constituencyType === 'RS' || p.constituencyType === 'MLC' ||
      p.house === 'Rajya Sabha' || p.house === 'Vidhan Parishad';
    if (!upperHouse) {
      if (!p.constituencyId || !consIds.has(p.constituencyId)) push(p, 'error', `constituencyId "${p.constituencyId}" not found in constituencies`);
      if (!p.districts?.length) push(p, 'warn', 'no districts listed (district-level ranking will be empty)');
    }
    if (!p.state || !p.stateCode) push(p, 'error', 'missing state/stateCode');
    if (p.house === 'Vidhan Sabha' && !assemblyCodes.has(p.stateCode)) {
      push(p, 'error', `no Assembly term data for stateCode ${p.stateCode}`);
    }
    if ((p.term_start && !isoDate.test(p.term_start)) || (p.term_end && !isoDate.test(p.term_end))) {
      push(p, 'error', 'term_start/term_end must use ISO yyyy-mm-dd');
    }
    if ((p.term_start && !p.term_end) || (!p.term_start && p.term_end)) {
      push(p, 'error', 'individual term must include both term_start and term_end');
    }
    for (const f of p.facts as Fact[]) {
      if (!f.source_url) push(p, 'error', `fact "${f.field_type}" has no source_url (no citation, no claim)`);
      if (!f.retrieved_date) push(p, 'warn', `fact "${f.field_type}" has no retrieved_date`);
    }
    // Contact block: a wrong number/address actively misdirects a citizen, so
    // every entry must be well-formed and the block must carry its citation.
    if (p.contact) {
      const c = p.contact;
      if (!c.source_url || !c.source_name) push(p, 'error', 'contact has no source citation (no citation, no claim)');
      if (!c.retrieved_date) push(p, 'warn', 'contact has no retrieved_date');
      if (!c.emails?.length && !c.phones?.length) push(p, 'error', 'contact block is empty - drop it instead');
      for (const e of c.emails || []) {
        if (!/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(e))
          push(p, 'error', `contact email "${e}" is not a valid address`);
      }
      for (const ph of c.phones || []) {
        // OFFICE LANDLINES ONLY (see contact-shared.ts): 0-led STD trunk form,
        // 10-11 digits, either hyphenated as the source printed it (min "0xx-")
        // or unhyphenated with a non-mobile-capable prefix (0[1-5]...). A
        // mobile-shaped number is an ERROR - personal mobiles are never
        // republished even when a directory prints them.
        const digits = ph.replace(/-/g, '');
        const shapeOk = /^[\d-]+$/.test(ph) && (ph.match(/-/g) || []).length <= 1;
        const hyphenAt = ph.indexOf('-');
        const landline = /^0\d{9,10}$/.test(digits) && (hyphenAt >= 3 || (hyphenAt === -1 && /^0[1-5]/.test(digits)));
        if (!shapeOk || !landline) {
          const mobileShaped = /^(?:91|0)?[6-9]\d{9}$/.test(digits);
          push(p, 'error', mobileShaped
            ? `contact phone "${ph}" looks like a personal mobile - office landlines only`
            : `contact phone "${ph}" is not an STD-prefixed office landline`);
        }
      }
    }
    if (!p.is_minister && Object.keys(p.metrics || {}).length === 0)
      push(p, 'warn', 'no scored metrics - performance percentile will be unavailable');
  }

  // ONE SEAT, ONE SITTING MLA.
  // Two active members for the same assembly constituency means a by-election
  // or resignation left a stale record behind (Shiggaon showed both Basavaraj
  // Bommai and his successor once). The public page would show a departed
  // member as sitting, so this is an ERROR and blocks publish.
  const mlaBySeat = new Map<string, Politician[]>();
  for (const p of politicians) {
    if (p.constituencyType !== 'AC' || !p.active || !p.constituencyId) continue;
    if (!mlaBySeat.has(p.constituencyId)) mlaBySeat.set(p.constituencyId, []);
    mlaBySeat.get(p.constituencyId)!.push(p);
  }
  for (const [seat, members] of mlaBySeat) {
    if (members.length < 2) continue;
    for (const p of members) {
      const others = members.filter((m) => m.id !== p.id).map((m) => m.id);
      push(p, 'error', `duplicate active MLA for ${seat} (also ${others.join(', ')}) - a by-election likely left a stale record`);
    }
  }

  // ONE PERSON, ONE ACTIVE MANDATE (lower houses).
  // The same Wikidata person active as both an MLA and a Lok Sabha MP usually
  // means they resigned the assembly seat after winning the parliamentary one
  // and our MLA record went stale. Warn (dual mandates exist briefly and QIDs
  // can be mis-resolved, so a human decides).
  const byQid = new Map<string, Politician[]>();
  for (const p of politicians) {
    if (!p.active || !p.wikidata_qid) continue;
    if (!byQid.has(p.wikidata_qid)) byQid.set(p.wikidata_qid, []);
    byQid.get(p.wikidata_qid)!.push(p);
  }
  for (const [qid, group] of byQid) {
    if (group.length < 2) continue;
    const houses = new Set(group.map((p) => p.constituencyType));
    if (houses.has('AC') && houses.has('PC')) {
      for (const p of group) {
        push(p, 'warn', `wikidata ${qid} is active in both an assembly and a Lok Sabha seat (${group.map((m) => m.id).join(', ')}) - one record may be stale`);
      }
    }
  }

  // ONE PERSON, ONE AFFIDAVIT PAGE.
  // A MyNeta candidate page describes exactly one candidate in one seat, so two
  // members citing the same page means one of them is publishing somebody else's
  // sworn declaration - the most damaging error this dataset can carry, and the
  // one every fuzzy-matching bug eventually produces. It has happened twice:
  // Bihar's Aurangabad winner attributed to Maharashtra's MP (16 declared
  // criminal cases against a man who declared 4), and Aizawl North-I's MLA
  // attributed to Aizawl North-II's. Both were invisible to name- and
  // seat-similarity checks but trivially visible here, so this is an ERROR and
  // blocks publish.
  const byPage = new Map<string, Politician[]>();
  for (const p of politicians) {
    const seen = new Set<string>();
    for (const f of p.facts as Fact[]) {
      if (!/myneta\.info\/[^/]+\/candidate\.php\?candidate_id=\d+/.test(f.source_url || '')) continue;
      if (seen.has(f.source_url)) continue; // one member may cite its page for several fields
      seen.add(f.source_url);
      if (!byPage.has(f.source_url)) byPage.set(f.source_url, []);
      byPage.get(f.source_url)!.push(p);
    }
  }
  for (const [url, members] of byPage) {
    if (members.length < 2) continue;
    for (const p of members) {
      const others = members.filter((m) => m.id !== p.id).map((m) => `${m.name} (${m.stateCode} ${m.constituencyName})`);
      push(p, 'error', `cites the same affidavit page as ${others.join(', ')} - one of them has another person's declaration: ${url}`);
    }
  }

  // CRIMINAL-CASE DETAIL MUST AGREE WITH THE COUNT FACT, PAGE FOR PAGE.
  // criminal_cases.json republishes what a member's own affidavit page lists
  // case by case. Wrong here means attributing FIRs and convictions to the
  // wrong person, so every record must (a) belong to a real member, (b) cite
  // exactly the page the member's criminal_cases_declared fact cites, and
  // (c) state the same total as that fact. Any disagreement blocks publish.
  const casesPath = resolve(SEED_DIR, 'criminal_cases.json');
  if (existsSync(casesPath)) {
    const records: CriminalRecord[] = JSON.parse(readFileSync(casesPath, 'utf8'));
    const byId = new Map(politicians.map((p) => [p.id, p]));
    const seen = new Set<string>();
    let covered = 0;
    for (const r of records) {
      const p = byId.get(r.politician_id);
      const rp = p ?? ({ id: r.politician_id, name: r.politician_id } as Politician);
      if (!p) { push(rp, 'error', 'criminal_cases.json record has no matching politician'); continue; }
      if (seen.has(r.politician_id)) push(p, 'error', 'duplicate criminal_cases.json record');
      seen.add(r.politician_id);
      if (!r.source_url) push(p, 'error', 'criminal-case record has no source_url (no citation, no claim)');
      if (!r.retrieved_date) push(p, 'warn', 'criminal-case record has no retrieved_date');
      const fact = p.facts.find((f) => f.field_type === 'criminal_cases_declared');
      if (!fact) push(p, 'error', 'criminal-case record but no criminal_cases_declared fact');
      else {
        if (fact.source_url !== r.source_url)
          push(p, 'error', `criminal-case record cites ${r.source_url} but the count fact cites ${fact.source_url}`);
        if (parseInt(fact.value, 10) !== r.declared_total)
          push(p, 'error', `criminal-case record says ${r.declared_total} cases, the count fact says ${fact.value}`);
        else covered++;
      }
      if (r.cases.length !== r.declared_total)
        push(p, 'warn', `affidavit declares ${r.declared_total} cases but the page listed ${r.cases.length} case rows`);
    }
    // Coverage is a single aggregate note, not 2,000 lines of warnings.
    const declaring = politicians.filter((p) => {
      const f = p.facts.find((x) => x.field_type === 'criminal_cases_declared');
      return f && parseInt(f.value, 10) > 0;
    }).length;
    if (covered < declaring) {
      issues.push({
        politicianId: '-', name: 'dataset', severity: 'warn',
        message: `${declaring - covered} of ${declaring} members with declared cases have no case-detail record yet (run "npm run dm -- fetch-criminal-cases")`,
      });
    }
  }

  // ONE HUMAN, ONE RATABLE PAGE.
  // A minister's `politicianId` links their executive role to their real MP/MLA
  // profile, so getPerson redirects the alias id to that one canonical page and
  // the vote is booked there. Two failure modes each mint a SECOND, ratable stub
  // page for the same person - so an ordinary voter can rate the same leader on
  // two pages (the "vote twice for one leader" report):
  //   (a) politicianId is SET but resolves to no politician (a stale/renamed id,
  //       e.g. after a by-election) - getPerson can't redirect, so it falls
  //       through and mints the stub. This is an ERROR: it is a broken link.
  //   (b) politicianId is MISSING but the person plainly has an MP/MLA record -
  //       a likely missed link. Names collide, so this is a WARNING for a human.
  const polById = new Map(politicians.map((p) => [p.id, p]));
  const central = loadJson<Minister>('central_government.json');
  const stateMinisters = loadJson<StateGovernment>('state_government.json').flatMap((g) => g.ministers || []);

  const dangling = (id: string, name: string, politicianId: string | undefined, scope: string) => {
    if (politicianId && !polById.has(politicianId)) {
      issues.push({
        politicianId: id, name, severity: 'error',
        message: `${scope} links politicianId "${politicianId}" but no politician has that id - getPerson cannot redirect, so it mints a duplicate ratable stub page`,
      });
    }
  };
  for (const m of central) dangling(m.id, m.name, m.politicianId, 'central minister');
  for (const m of stateMinisters) dangling(m.id, m.name, m.politicianId, 'state minister');

  // Conservative: normalised EXACT name match, within the same state only. No
  // fuzzy matching - a false positive here is cheap (a human confirms the warn),
  // a false blocking error is not.
  const normName = (s: string) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const sittingByCode = new Map<string, Politician[]>(); // name|stateCode
  const sittingByState = new Map<string, Politician[]>(); // name|stateName (central ministers carry no code)
  for (const p of politicians) {
    if (p.active === false) continue;
    const nn = normName(p.name);
    for (const [map, key] of [
      [sittingByCode, `${nn}|${p.stateCode}`],
      [sittingByState, `${nn}|${normName(p.state)}`],
    ] as [Map<string, Politician[]>, string][]) {
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
  }
  for (const m of central) {
    if (m.politicianId) continue;
    const match = sittingByState.get(`${normName(m.name)}|${normName(m.state || '')}`);
    if (match?.length)
      issues.push({
        politicianId: m.id, name: m.name, severity: 'warn',
        message: `central minister has no politicianId but a sitting member with the same name exists in ${m.state} (${match.map((x) => x.id).join(', ')}) - likely a missed link that mints a duplicate ratable page`,
      });
  }
  for (const m of stateMinisters) {
    if (m.politicianId) continue;
    const match = sittingByCode.get(`${normName(m.name)}|${m.stateCode || ''}`);
    if (match?.length)
      issues.push({
        politicianId: m.id, name: m.name, severity: 'warn',
        message: `state minister has no politicianId but a sitting member with the same name exists in ${m.state || m.stateCode} (${match.map((x) => x.id).join(', ')}) - likely a missed link that mints a duplicate ratable page`,
      });
  }

  validateElections(issues, politicians, consIds);

  return { issues, ok: !issues.some((i) => i.severity === 'error') };
}

/**
 * data/seed/elections.json. Same rule as everything else - no citation, no
 * claim - plus three checks specific to elections:
 *
 *  - Every seat must join a real constituency, or /area and /elections show
 *    different places under the same name.
 *  - Slugs must be unique, because they are URLs people bookmark and share.
 *  - A candidate must never be BOTH linked to a sitting member and separately
 *    ratable. That is the double-vote vector this site has already shipped
 *    once: one human, two ratable pages, one visitor rating them twice.
 */
function validateElections(issues: Issue[], politicians: Politician[], consIds: Set<string>) {
  const events = loadJson<ElectionEvent>('elections.json');
  if (events.length === 0) return;

  const politicianIds = new Set(politicians.map((p) => p.id));
  const seenSeat = new Set<string>();
  const push = (id: string, name: string, severity: Issue['severity'], message: string) =>
    issues.push({ politicianId: id, name, severity, message });

  // The whole file is statically imported into every serverless function, so
  // its size is a runtime cost on every route, not just this page.
  const bytes = existsSync(resolve(SEED_DIR, 'elections.json'))
    ? readFileSync(resolve(SEED_DIR, 'elections.json')).byteLength
    : 0;
  if (bytes > 512 * 1024) {
    push('elections.json', 'elections', 'error',
      `${(bytes / 1024).toFixed(0)} KB exceeds the 512 KB budget - move candidate lists to a lazily-fetched public/*.json (see tools/build-who-data.ts)`);
  }

  for (const ev of events) {
    if (!ev.source_url || !ev.source_name) push(ev.id, ev.title, 'error', 'election has no source citation (no citation, no claim)');
    if (!ev.retrieved_date) push(ev.id, ev.title, 'warn', 'election has no retrieved_date');
    for (const k of ['pollDate', 'countingDate', 'pollClose'] as const) {
      if (!ev.schedule?.[k]) push(ev.id, ev.title, 'error', `schedule.${k} is missing - the phase, the countdown and the rating lock all derive from it`);
    }

    for (const seat of ev.seats) {
      const label = `${seat.constituencyName} (${ev.id})`;
      if (seenSeat.has(seat.slug)) push(seat.slug, label, 'error', `duplicate seat slug "${seat.slug}" - slugs are public URLs`);
      seenSeat.add(seat.slug);
      if (!consIds.has(seat.constituencyId)) push(seat.slug, label, 'error', `constituencyId "${seat.constituencyId}" not found in constituencies`);
      if (!seat.eci?.stateCode || !seat.eci?.acNo) push(seat.slug, label, 'error', 'missing eci.stateCode/acNo - the results URL cannot be built');

      const seenCand = new Set<string>();
      for (const c of seat.candidates) {
        const cl = `${c.name} - ${seat.constituencyName}`;
        if (seenCand.has(c.slug)) push(c.slug, cl, 'error', `duplicate candidate slug "${c.slug}" within ${seat.slug}`);
        seenCand.add(c.slug);
        if (!c.source_url || !c.source_name) push(c.slug, cl, 'error', 'candidate has no source citation (no citation, no claim)');
        if (!c.retrieved_date) push(c.slug, cl, 'warn', 'candidate has no retrieved_date');
        if (c.politicianId && !politicianIds.has(c.politicianId)) {
          push(c.slug, cl, 'error', `politicianId "${c.politicianId}" does not exist - the candidate page would redirect to a 404`);
        }
        for (const f of c.facts ?? []) {
          if (!f.source_url) push(c.slug, cl, 'error', `fact "${f.field_type}" has no source_url (no citation, no claim)`);
        }
        if (c.criminal && !c.criminal.source_url) push(c.slug, cl, 'error', 'declared-cases record has no source_url');
      }

      if (seat.result) {
        const r = seat.result;
        if (!r.source_url || !r.source_name) push(seat.slug, label, 'error', 'result has no source citation (no citation, no claim)');
        if (!r.rows?.length) push(seat.slug, label, 'error', 'result has no rows - drop it instead of storing an empty count');
        if (r.winner_slug && !seat.candidates.some((c) => c.slug === r.winner_slug)) {
          push(seat.slug, label, 'error', `winner_slug "${r.winner_slug}" is not a candidate on this seat`);
        }
      }
    }
  }
}

export function datasetStats() {
  const { politicians, constituencies } = loadSeed();
  const states = new Set(politicians.map((p) => p.stateCode));
  const facts = politicians.reduce((n, p) => n + p.facts.length, 0);
  return {
    politicians: politicians.length,
    constituencies: constituencies.length,
    states: states.size,
    facts,
    ministers: politicians.filter((p) => p.is_minister).length,
  };
}

function loadJson<T>(name: string): T[] {
  const p = resolve(SEED_DIR, name);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

/** Write the full dataset to Firestore. Requires Admin credentials. */
export async function publishDataset(): Promise<{
  politicians: number;
  constituencies: number;
  central_government: number;
  office_seats: number;
}> {
  const { getDb } = await import('../../lib/firebase-admin');
  const db = getDb();
  if (!db)
    throw new Error(
      'Firestore is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS in .env.local (see .env.example).',
    );

  const { politicians, constituencies } = loadSeed();
  const central = loadJson<{ id: string }>('central_government.json');
  const officials = loadJson<{ id: string }>('district_officials.json');

  const commitInChunks = async (coll: string, docs: { id: string }[]) => {
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + 400)) batch.set(db.collection(coll).doc(d.id), d as any);
      await batch.commit();
    }
  };

  await commitInChunks('constituencies', constituencies);
  await commitInChunks('politicians', politicians);
  await commitInChunks('central_government', central);
  await commitInChunks('office_seats', officials);
  return {
    politicians: politicians.length,
    constituencies: constituencies.length,
    central_government: central.length,
    office_seats: officials.length,
  };
}

/** Ask the deployed site to drop its page cache (POST /api/revalidate) so the
 *  publish shows up on the next visit instead of the next timed revalidation.
 *  No-op unless REVALIDATE_URL and REVALIDATE_SECRET are set in .env.local,
 *  and never fatal: the publish itself already succeeded, and pages self-heal
 *  regardless (hub pages within a day, the long tail within a week - so a
 *  failure here is worth fixing, not ignoring). */
export async function requestSiteRevalidation(): Promise<void> {
  const base = process.env.REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!base || !secret) {
    console.log(
      'i Skipped site revalidation (REVALIDATE_URL / REVALIDATE_SECRET not set) - hub pages refresh within a day, long-tail pages within a WEEK.',
    );
    return;
  }
  try {
    const res = await fetch(new URL('/api/revalidate', base), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
    if (res.ok) {
      console.log('✓ Site cache invalidated - pages regenerate on next visit.');
      console.log(
        '  Reminder: run `npm run dm -- revalidate` once more in ~35 min. A page that',
        '\n  regenerates just after a publish can bake the previous in-process TTL snapshot',
        '\n  (lib/data.ts memos, up to 30 min stale); a second sweep re-renders those.',
      );
    } else {
      console.log(
        `⚠ Site revalidation returned ${res.status} - the publish stays invisible until pages self-heal (long tail: up to a WEEK).` +
          (res.status === 401
            ? '\n  401 hint: REVALIDATE_URL must use the canonical www host - a host redirect drops the Authorization header (see CLAUDE.md).'
            : ''),
      );
    }
  } catch (err) {
    console.log(
      `⚠ Site revalidation failed (${err instanceof Error ? err.message : err}) - the publish stays invisible until pages self-heal (long tail: up to a WEEK).`,
    );
  }
}
