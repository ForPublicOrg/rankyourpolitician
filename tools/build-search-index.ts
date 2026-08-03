// Generates the static client-side search index (public/search-index.json).
//
// Why: search used to hit a serverless route that imported the full 7.7MB seed
// and recomputed every ranking on each cold start - seconds of latency per
// keystroke. Instead we precompute a compact index at build time; the browser
// fetches it once (~150KB gzipped) and every search after that is instant and
// free (no server, no Firestore reads).
//
// Run: npx tsx tools/build-search-index.ts   (also wired to `npm run prebuild`)
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import seedPoliticians from '../data/seed/politicians.json';
import seedConstituencies from '../data/seed/constituencies.json';
import seedCentral from '../data/seed/central_government.json';
import seedStateGov from '../data/seed/state_government.json';
import seedDistrictOfficials from '../data/seed/district_officials.json';
import seedConstitutional from '../data/seed/constitutional_offices.json';
import seedElections from '../data/seed/elections.json';
import type {
  Politician,
  Minister,
  StateGovernment,
  OfficeSeat,
  ConstitutionalOffice,
  ElectionEvent,
} from '../lib/types';

// Row shapes (positional arrays keep the file small):
//   people:    [id, name, partyShort, place, stateCode, role, nameHi?, photo?, portfolios?]
//   areas:     [id, name, stateCode, type]
//   districts: [stateCode, name]
//   states:    [code, name]
//   elections: [seatSlug, seatName, stateCode, pollDate, countingDate, declared?]  declared = '1' once a result is frozen
export interface SearchIndexFile {
  v: 1;
  builtAt: string;
  states: [string, string][];
  people: (string | undefined)[][];
  areas: [string, string, string, string][];
  districts: [string, string][];
  elections: [string, string, string, string, string, string?][];
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** "Bharatiya Janata Party (BJP)" → "BJP"; otherwise the full name. */
function partyShort(party: string): string {
  const m = party.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : party;
}

const ROLE_BY_HOUSE: Record<string, string> = {
  'Lok Sabha': 'MP · Lok Sabha',
  'Rajya Sabha': 'MP · Rajya Sabha',
  'Vidhan Sabha': 'MLA',
  'Vidhan Parishad': 'MLC',
};

function build(): SearchIndexFile {
  const politicians = seedPoliticians as unknown as Politician[];
  const central = seedCentral as unknown as Minister[];
  const stateGov = seedStateGov as unknown as StateGovernment[];
  const officials = seedDistrictOfficials as unknown as OfficeSeat[];

  const stateByCode = new Map<string, string>();
  for (const p of politicians) if (p.stateCode && p.state) stateByCode.set(p.stateCode, p.state);

  const people = new Map<string, (string | undefined)[]>();
  // Portfolios a person answers for, union + state. Kept as search keywords
  // only (slot [8]) so "education" finds whoever currently holds Education,
  // rather than the citizen having to already know the minister's name.
  const portfolios = new Map<string, Set<string>>();
  const addPortfolios = (id: string, list: string[] | undefined) => {
    if (!list?.length) return;
    const set = portfolios.get(id) ?? portfolios.set(id, new Set()).get(id)!;
    for (const p of list) if (p?.trim()) set.add(p.trim());
  };

  for (const p of politicians) {
    people.set(p.id, [
      p.id,
      p.name,
      partyShort(p.party),
      p.constituencyName,
      p.stateCode,
      ROLE_BY_HOUSE[p.house] || p.house,
      p.name_hi,
      p.photo_url, // [7] photo - so search results show faces, not just an icon
    ]);
  }

  // Union ministers - upgrade the role label for linked MPs, add unlinked ones.
  for (const m of central) {
    const id = m.politicianId || m.id;
    const role = m.rank === 'PM' ? 'Prime Minister' : 'Union Minister';
    addPortfolios(id, m.portfolios);
    const existing = people.get(id);
    if (existing) {
      existing[5] = `${role} · ${existing[5]}`;
      if (!existing[7] && m.photo_url) existing[7] = m.photo_url;
    } else {
      people.set(id, [id, m.name, partyShort(m.party), m.portfolios[0] || '', '', role, undefined, m.photo_url]);
    }
  }

  // Constitutional offices - upgrade the role label for linked MPs (Speaker,
  // Leaders of the Opposition); the unlinked Head-of-State offices (President,
  // VP) get their own searchable entry pointing at their info-only profile.
  for (const o of seedConstitutional as unknown as ConstitutionalOffice[]) {
    if (o.politicianId) {
      const existing = people.get(o.politicianId);
      if (existing) existing[5] = `${o.title} · ${existing[5]}`;
    } else if (!people.has(o.id)) {
      people.set(o.id, [o.id, o.name, '', '', '', o.title, undefined, o.photo_url]);
    }
  }

  // State CMs / ministers - same pattern.
  for (const g of stateGov) {
    for (const sm of g.ministers) {
      const id = sm.politicianId || sm.id;
      const role =
        sm.rank === 'CM' ? `Chief Minister, ${g.state}`
        : sm.rank === 'DyCM' ? `Dy Chief Minister, ${g.state}`
        : `Minister, ${g.state}`;
      addPortfolios(id, sm.portfolios);
      const existing = people.get(id);
      if (existing) {
        if (sm.rank === 'CM' || sm.rank === 'DyCM') existing[5] = `${role.split(',')[0]} · ${existing[5]}`;
        if (!existing[7] && sm.photo_url) existing[7] = sm.photo_url;
      } else {
        people.set(id, [id, sm.name, partyShort(sm.party), '', sm.stateCode, role, undefined, sm.photo_url]);
      }
    }
  }

  // Appointed district officials (info-only profiles).
  for (const seat of officials) {
    if (!seat.incumbent) continue;
    const id = slugify(seat.incumbent.name);
    if (!people.has(id)) {
      const label = seat.officeType === 'collector_dm' ? 'District Collector / DM' : seat.officeType === 'sp_district' ? 'Superintendent of Police' : 'Official';
      people.set(id, [id, seat.incumbent.name, seat.incumbent.service || 'Official', seat.district || '', seat.stateCode || '', label]);
    }
  }

  // Areas (constituencies) - dedupe by id.
  const seenAreas = new Set<string>();
  const areas: [string, string, string, string][] = [];
  const constituencies = seedConstituencies as unknown as { id: string; name: string; stateCode: string; type: string }[];
  for (const c of constituencies) {
    if (seenAreas.has(c.id)) continue;
    seenAreas.add(c.id);
    areas.push([c.id, c.name, c.stateCode, c.type]);
  }

  // Elections - SEATS ONLY, never the individual candidates. One by-election
  // can carry 75 nominations, so indexing candidates would add hundreds of rows
  // to the payload EVERY visitor downloads, for names almost nobody searches;
  // the seat page lists them all and is one tap from here.
  //
  // Slots [3] and [4] are the Commission's cited poll and counting dates, not a
  // phase label: this file is static between deploys, so a baked "Voting soon"
  // would still say that a week after the poll closed. Storing both dates is
  // what lets the search row say "Counting now" on counting day instead of
  // disagreeing with the page it links to. Slot [5] is set only when a result
  // has been frozen into the seed - itself a data change that rebuilds this
  // index - so every label a reader sees derives from facts that cannot go
  // stale (see electionSearchSub() in lib/elections.ts).
  const elections: [string, string, string, string, string, string?][] = [];
  for (const ev of seedElections as unknown as ElectionEvent[]) {
    for (const seat of ev.seats) {
      const row: [string, string, string, string, string, string?] = [
        seat.slug,
        seat.constituencyName,
        seat.stateCode,
        ev.schedule.pollDate,
        ev.schedule.countingDate,
      ];
      if (seat.result) row.push('1');
      elections.push(row);
    }
  }

  // Districts (from politicians' coverage lists).
  const seenD = new Set<string>();
  const districts: [string, string][] = [];
  for (const p of politicians) {
    for (const d of p.districts) {
      if (!d?.trim()) continue; // blank names must not become searchable districts
      const key = `${p.stateCode}|${d}`;
      if (seenD.has(key)) continue;
      seenD.add(key);
      districts.push([p.stateCode, d]);
    }
  }
  districts.sort((a, b) => a[1].localeCompare(b[1]));

  const states = [...stateByCode.entries()]
    .map(([code, name]) => [code, name] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1]));

  // Attach the portfolio keywords last, so every role loop above has had its say.
  for (const [id, set] of portfolios) {
    const row = people.get(id);
    if (row) row[8] = [...set].join(' · ');
  }

  return {
    v: 1,
    builtAt: new Date().toISOString().slice(0, 10),
    states,
    people: [...people.values()],
    areas,
    districts,
    elections,
  };
}

const idx = build();
const out = JSON.stringify(idx);
const dest = join(process.cwd(), 'public', 'search-index.json');
mkdirSync(join(process.cwd(), 'public'), { recursive: true });
writeFileSync(dest, out);
console.log(
  `✓ search index: ${idx.people.length} people, ${idx.areas.length} areas, ${idx.districts.length} districts, ${idx.states.length} states, ${idx.elections.length} election seats → public/search-index.json (${(out.length / 1024).toFixed(0)} KB raw)`,
);
