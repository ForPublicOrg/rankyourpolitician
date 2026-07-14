// Generates the static "real people" payloads for the responsibility finder:
//   public/who/index.json  — [[stateCode, stateName], …]
//   public/who/{ST}.json   — WhoStateFile: CM + ministers (with portfolios),
//                            and per-district DM/SP + MLAs + MPs
// Same free-tier philosophy as the search index: built from the committed seed
// at `prebuild`, served from the CDN, fetched once per state by the client.
//
// Run: npx tsx tools/build-who-data.ts   (wired into `npm run prebuild`)
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import seedPoliticians from '../data/seed/politicians.json';
import seedStateGov from '../data/seed/state_government.json';
import seedDistrictOfficials from '../data/seed/district_officials.json';
import type { Politician, StateGovernment, OfficeSeat } from '../lib/types';
import type { WhoStateFile, WhoPerson, WhoDistrict, WhoOfficial } from '../lib/responsibility';
import { STATE_RANK_LABEL } from '../lib/types';

const politicians = seedPoliticians as unknown as Politician[];
const stateGovs = seedStateGov as unknown as StateGovernment[];
const officials = seedDistrictOfficials as unknown as OfficeSeat[];

// Minister records carry no images of their own — take the photo from the
// linked politician profile so CM/minister cards show faces, not initials.
const photoById = new Map(politicians.filter((p) => p.photo_url).map((p) => [p.id, p.photo_url!]));
const ministerPhoto = (m: { politicianId?: string; photo_url?: string }): string | undefined =>
  m.photo_url || (m.politicianId ? photoById.get(m.politicianId) : undefined);

function partyShort(party?: string): string | undefined {
  if (!party) return undefined;
  const m = party.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : party;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// state → district(norm) → display name + members
interface Bucket {
  display: string;
  mlas: WhoPerson[];
  mps: WhoPerson[];
}
const states = new Map<string, { name: string; districts: Map<string, Bucket> }>();

for (const p of politicians) {
  if (p.stateCode === 'NOM') continue;
  if (!states.has(p.stateCode)) states.set(p.stateCode, { name: p.state, districts: new Map() });
  const st = states.get(p.stateCode)!;
  if (p.constituencyType !== 'PC' && p.constituencyType !== 'AC') continue;
  for (const d of p.districts) {
    const key = norm(d);
    if (!st.districts.has(key)) st.districts.set(key, { display: d, mlas: [], mps: [] });
    const bucket = st.districts.get(key)!;
    const person: WhoPerson = {
      id: p.id,
      name: p.name,
      party: partyShort(p.party),
      photo: p.photo_url,
      sub: p.constituencyName,
    };
    if (p.constituencyType === 'AC') bucket.mlas.push(person);
    else bucket.mps.push(person);
  }
}

const outDir = join(process.cwd(), 'public', 'who');
mkdirSync(outDir, { recursive: true });

let written = 0;
let districtsTotal = 0;
for (const [code, st] of states) {
  const gov = stateGovs.find((g) => g.stateCode === code);
  const cmM = gov?.ministers.find((m) => m.rank === 'CM');
  const toWho = (m: NonNullable<typeof cmM>): WhoPerson => ({
    id: m.politicianId || m.id,
    name: m.name,
    party: partyShort(m.party),
    photo: ministerPhoto(m),
    sub: STATE_RANK_LABEL[m.rank],
    portfolios: m.portfolios,
  });

  const districts: Record<string, WhoDistrict> = {};
  const sorted = [...st.districts.values()].sort((a, b) => a.display.localeCompare(b.display));
  for (const b of sorted) {
    const byName = (x: WhoPerson, y: WhoPerson) => (x.sub || '').localeCompare(y.sub || '');
    const seats = officials.filter(
      (s) => s.stateCode === code && s.district && norm(s.district) === norm(b.display) && s.incumbent,
    );
    const offs: WhoOfficial[] = seats
      .filter((s) => s.officeType === 'collector_dm' || s.officeType === 'sp_district')
      .map((s) => ({
        officeType: s.officeType as WhoOfficial['officeType'],
        name: s.incumbent!.name,
        service: s.incumbent!.service,
        email: s.incumbent!.office_email,
        phone: s.incumbent!.office_phone,
        asOf: s.incumbent!.as_of,
        sourceName: s.incumbent!.source_name,
        sourceUrl: s.incumbent!.source_url,
      }));
    districts[b.display] = { officials: offs, mlas: b.mlas.sort(byName), mps: b.mps.sort(byName) };
    districtsTotal++;
  }

  const file: WhoStateFile = {
    v: 1,
    stateCode: code,
    state: st.name,
    asOf: gov?.asOf ? gov.asOf.replace(/^\s*as of\s*/i, '').split(/[;(]/)[0].trim() : undefined,
    cm: cmM ? toWho(cmM) : undefined,
    ministers: (gov?.ministers ?? []).map(toWho),
    districts,
  };
  writeFileSync(join(outDir, `${code}.json`), JSON.stringify(file));
  written++;
}

const index = [...states.entries()]
  .map(([code, st]) => [code, st.name] as [string, string])
  .sort((a, b) => a[1].localeCompare(b[1]));
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index));

console.log(`✓ who-data: ${written} state files, ${districtsTotal} districts → public/who/`);
