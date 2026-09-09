/**
 * Shared plumbing for the election ingest commands (LOCAL ONLY - never deployed).
 *
 * The registry below is the one hand-authored thing in the whole feature. Every
 * date in it is transcribed from the Election Commission's own press note, and
 * the citation on each event points at the page that publishes it, so the claim
 * is checkable. Nothing else about an election is typed by hand: candidates come
 * from ECI's affidavit portal, counts from ECI's results microsite.
 *
 * Adding the next election is one entry here plus:
 *     npx tsx tools/data-manager/import-elections.ts --apply
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ElectionEvent } from '../../lib/types';
import { ECI_HEADERS } from '../../lib/eci-results';

export const ROOT = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
  '..',
);
export const SEED_DIR = resolve(ROOT, 'data', 'seed');
export const ELECTIONS_SEED = resolve(SEED_DIR, 'elections.json');
export const PUBLIC_DIR = resolve(ROOT, 'public');
export const TODAY = new Date().toISOString().slice(0, 10);

/** How big the seed may get before it must move to a lazily-fetched
 *  public/*.json payload (the tools/build-who-data.ts pattern). A 234-seat
 *  general election will cross this; three by-election seats are nowhere near. */
export const SEED_BUDGET_BYTES = 512 * 1024;

/** One election we track, with everything needed to reach ECI's own pages.
 *  `acs` lists the seats by the Commission's own numbering. */
export interface EventSpec {
  event: Omit<ElectionEvent, 'seats'>;
  /** Query params of the ECI candidate-affidavit list for this event. */
  affidavit: { electionType: string; election: string };
  /** Seat number -> our constituency id, per state. The explicit mapping is
   *  deliberate: seat names repeat across India (Bihar and UP both have a
   *  Maharajganj), so nothing is matched on name alone. */
  seats: { constituencyId: string; acNo: number; eciStateCode: string; vacancyReason?: string }[];
}

/**
 * ECI's own state codes, used only to BUILD result URLs. Each one here has been
 * confirmed against a live results page; `verifyEciCode` re-checks at ingest
 * time by comparing the page heading, so a wrong code fails loudly instead of
 * quietly fetching another state's seat.
 */
export const ECI_STATE_CODE: Record<string, string> = {
  AS: 'S03',
  BR: 'S04',
  GJ: 'S06',
  MP: 'S12',
  TN: 'S22',
  WB: 'S25',
  // Puducherry is a Union Territory: ECI numbers it U07 (its affidavit portal's
  // own state list), not S-anything.
  PY: 'U07',
};

export const EVENTS: EventSpec[] = [
  {
    event: {
      id: 'ac-bye-2026-07',
      title: 'By-elections to three Assembly constituencies',
      kind: 'assembly-bye',
      authority: 'ECI',
      schedule: {
        notification: '2026-07-06',
        nominationLast: '2026-07-13',
        scrutiny: '2026-07-14',
        withdrawalLast: '2026-07-16',
        pollDate: '2026-07-30',
        pollOpen: '07:00',
        pollClose: '18:00',
        countingDate: '2026-08-03',
        completeBy: '2026-08-04',
      },
      results_base: 'https://results.eci.gov.in/ResultAcByeAugust2026',
      affidavit_url:
        'https://affidavit.eci.gov.in/CandidateCustomFilter?electionType=33-AC-BYE-4-62&election=33-AC-BYE-4-62',
      source_url: 'https://www.eci.gov.in/bye-elections',
      source_name:
        'Election Commission of India - Schedule for bye-elections to 03 Assembly Constituencies of Bihar, Madhya Pradesh and Gujarat',
      retrieved_date: '2026-08-03',
    },
    affidavit: { electionType: '33-AC-BYE-4-62', election: '33-AC-BYE-4-62' },
    seats: [
      { constituencyId: 'ac-br-bankipur', acNo: 182, eciStateCode: 'S04' },
      { constituencyId: 'ac-gj-manjalpur', acNo: 145, eciStateCode: 'S06' },
      { constituencyId: 'ac-mp-datia', acNo: 22, eciStateCode: 'S12' },
    ],
  },
  // ECI Press Note No. ECI/PN/114/2026 dated 7 September 2026 (the Commission's
  // own bye-election listing at /bye-elections and its details API both carry
  // these dates verbatim). Poll HOURS are not printed in the press note - they
  // are fixed by the Gazette notification of 9 September - so 07:00-18:00, the
  // hours the Commission notified for every 2026 bye-election so far, are used
  // here and MUST be re-checked against the notification once it is online:
  // they drive the s.126 silence window (lib/elections.ts).
  {
    event: {
      id: 'ac-bye-2026-10',
      title: 'By-elections to five Assembly constituencies',
      kind: 'assembly-bye',
      authority: 'ECI',
      schedule: {
        notification: '2026-09-09',
        nominationLast: '2026-09-16',
        scrutiny: '2026-09-17',
        withdrawalLast: '2026-09-19',
        pollDate: '2026-10-06',
        pollOpen: '07:00',
        pollClose: '18:00',
        countingDate: '2026-10-09',
        completeBy: '2026-10-11',
      },
      affidavit_url:
        'https://affidavit.eci.gov.in/CandidateCustomFilter?electionType=34-AC-BYE-4-63&election=34-AC-BYE-4-63',
      source_url: 'https://www.eci.gov.in/bye-elections',
      source_name:
        'Election Commission of India - Schedule for bye-elections to 05 (Five) Assembly Constituencies of Tamil Nadu, Puducherry and West Bengal and 01 (One) Parliamentary Constituency of Assam (Press Note ECI/PN/114/2026)',
      retrieved_date: '2026-09-09',
    },
    affidavit: { electionType: '34-AC-BYE-4-63', election: '34-AC-BYE-4-63' },
    seats: [
      { constituencyId: 'ac-tn-madurantakam', acNo: 35, eciStateCode: 'S22', vacancyReason: 'Resignation of Tmt. Maragatham Kumaravel' },
      { constituencyId: 'ac-tn-dharapuram', acNo: 101, eciStateCode: 'S22', vacancyReason: 'Resignation of Tmt. P. Sathyabama' },
      { constituencyId: 'ac-py-thattanchavady', acNo: 9, eciStateCode: 'U07', vacancyReason: 'Resignation of Thiru N. Rangasamy' },
      { constituencyId: 'ac-wb-rejinagar', acNo: 70, eciStateCode: 'S25', vacancyReason: 'Resignation of Sh. Humayun Kabir' },
      { constituencyId: 'ac-wb-nandigram', acNo: 210, eciStateCode: 'S25', vacancyReason: 'Resignation of Sh. Suvendu Adhikari' },
    ],
  },
  {
    event: {
      id: 'pc-bye-2026-10',
      title: 'By-election to the Nagaon Lok Sabha constituency',
      kind: 'lok-sabha-bye',
      authority: 'ECI',
      schedule: {
        notification: '2026-09-09',
        nominationLast: '2026-09-16',
        scrutiny: '2026-09-17',
        withdrawalLast: '2026-09-19',
        pollDate: '2026-10-06',
        pollOpen: '07:00',
        pollClose: '18:00',
        countingDate: '2026-10-09',
        completeBy: '2026-10-11',
      },
      affidavit_url:
        'https://affidavit.eci.gov.in/CandidateCustomFilter?electionType=34-PC-BYE-2-64&election=34-PC-BYE-2-64',
      source_url: 'https://www.eci.gov.in/bye-elections',
      source_name:
        'Election Commission of India - Schedule for bye-elections to 05 (Five) Assembly Constituencies of Tamil Nadu, Puducherry and West Bengal and 01 (One) Parliamentary Constituency of Assam (Press Note ECI/PN/114/2026)',
      retrieved_date: '2026-09-09',
    },
    affidavit: { electionType: '34-PC-BYE-2-64', election: '34-PC-BYE-2-64' },
    seats: [{ constituencyId: 'pc-as-nagaon', acNo: 9, eciStateCode: 'S03', vacancyReason: 'Resignation of Sh. Pradyut Bordoloi' }],
  },
];

export function loadElections(): ElectionEvent[] {
  if (!existsSync(ELECTIONS_SEED)) return [];
  return JSON.parse(readFileSync(ELECTIONS_SEED, 'utf8')) as ElectionEvent[];
}

export function saveElections(events: ElectionEvent[]) {
  const json = JSON.stringify(events, null, 2) + '\n';
  const bytes = Buffer.byteLength(json);
  if (bytes > SEED_BUDGET_BYTES) {
    throw new Error(
      `elections.json would be ${(bytes / 1024).toFixed(0)} KB, over the ${SEED_BUDGET_BYTES / 1024} KB budget. ` +
        'It is statically imported into every serverless function, so it must stay small - split the candidate ' +
        'lists into public/*.json and fetch them client-side (see tools/build-who-data.ts + components/Finder.tsx).',
    );
  }
  writeFileSync(ELECTIONS_SEED, json);
}

export function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

/** GET an ECI page with the header set their edge insists on (see
 *  lib/eci-results.ts). Retries transient failures; null means "gave up". */
export async function fetchEci(url: string, tries = 4): Promise<string | null> {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers: ECI_HEADERS, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
      console.warn(`  ! ${url} -> HTTP ${r.status} (attempt ${a + 1}/${tries})`);
    } catch (err) {
      console.warn(`  ! ${url} -> ${(err as Error).message} (attempt ${a + 1}/${tries})`);
    }
    await new Promise((s) => setTimeout(s, 800 * (a + 1)));
  }
  return null;
}

/** Same headers, but as a browser asks for an image. */
export async function fetchEciBinary(url: string, tries = 3): Promise<Buffer | null> {
  const headers = {
    ...ECI_HEADERS,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Dest': 'image',
  };
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 700 * (a + 1)));
  }
  return null;
}

export const slug = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Loose seat-name key: ECI prints "DATIA", we hold "Datia"; punctuation and
 *  "and"/"&" differ across sources. Never fuzzy - just normalised. */
export const seatKey = (s: string) =>
  (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

export const HELP_APPLY =
  'Dry run - nothing written. Re-run with --apply to write. (On Windows npm swallows the flag: use `npx tsx tools/data-manager/<script>.ts --apply`.)';
