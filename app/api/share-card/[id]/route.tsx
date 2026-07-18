/* Shareable Open Graph card for a person. It works as a standalone intro - who
 * they are, the office they hold - and teases what the site knows about them
 * (public rating, declared wealth, declared court cases, contact) BLURRED, so
 * the numbers are legible only inside the site. A shared card tells the story
 * and pulls the reader to the profile to reveal the details.
 *
 * Speed / cost (see CLAUDE.md "How data flows"):
 * - Built ONLY from the committed seed via getPerson (identity + affidavit
 *   facts). The blurred panels are decorative, so this route reads NO live vote
 *   data and never varies with votes - immutable per person per deploy.
 * - Off the page render path entirely: referenced by the profile's og:image
 *   meta (link-unfurl bots) and lazily by the share buttons. The long
 *   Cache-Control makes it a CDN hit after the first render.
 *
 * Neutrality (CLAUDE.md rule 3 / README defamation checklist): court-case counts
 * are deliberately NOT teased here. On this broadcast surface (og:image) a
 * "declared cases" chip would appear only for people who have a case record, so
 * its mere presence is a guilt inference - the inverse of the profile, where the
 * cases section always renders with a presumption-of-innocence note, the citation
 * and a "no cases declared" panel. Declared cases stay on the profile. The rating
 * is a redacted placeholder (never a fabricated score); wealth and contact are
 * public, cited facts shown blurred.
 */
import { ImageResponse } from 'next/og';
import { getPerson } from '@/lib/data';
import { initials, avatarTint } from '@/lib/format';

export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;

// Site palette (globals.css tokens resolved to hex - satori needs literals).
const C = {
  ink: '#1c202a',
  inkSoft: '#4a5160',
  inkFaint: '#7c8496',
  line: '#e8e4dc',
  brand: '#4f46e5',
  brandInk: '#3730a3',
  brandSoft: '#eef1ff',
  ratingInk: '#b45309',
  ratingSoft: '#fef4e2',
  amber: '#f59e0b',
  paperSoft: '#f8f7f4',
  paperSink: '#f0eee8',
};

const HOUSE_ROLE: Record<string, string> = {
  'Lok Sabha': 'Member of Parliament, Lok Sabha',
  'Rajya Sabha': 'Member of Parliament, Rajya Sabha',
  'Vidhan Sabha': 'Member of the Legislative Assembly',
  'Vidhan Parishad': 'Member of the Legislative Council',
};

// Manrope (the site font) fetched once per warm instance, module-cached; on any
// failure the card still renders in satori's default font. Woff (satori
// supports ttf/otf/woff, not woff2). Server fetch - browser CSP does not apply.
type FontSpec = { name: string; data: ArrayBuffer; weight: 400 | 700 | 800; style: 'normal' };
let fontsPromise: Promise<FontSpec[] | null> | null = null;
function loadFonts(): Promise<FontSpec[] | null> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const base = 'https://cdn.jsdelivr.net/npm/@fontsource/manrope@5/files';
      const specs: { weight: 400 | 700 | 800; file: string }[] = [
        { weight: 400, file: 'manrope-latin-400-normal.woff' },
        { weight: 700, file: 'manrope-latin-700-normal.woff' },
        { weight: 800, file: 'manrope-latin-800-normal.woff' },
      ];
      try {
        return await Promise.all(
          specs.map(async (s) => {
            // Bound the CDN fetch like fetchPhoto does: a slow (not just failed)
            // jsDelivr must fall through to the default font, never stall a render.
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 2500);
            try {
              const res = await fetch(`${base}/${s.file}`, { signal: ctrl.signal });
              if (!res.ok) throw new Error(`font ${s.file} ${res.status}`);
              return { name: 'Manrope', data: await res.arrayBuffer(), weight: s.weight, style: 'normal' as const };
            } finally {
              clearTimeout(timer);
            }
          }),
        );
      } catch {
        return null;
      }
    })();
  }
  return fontsPromise;
}

function Star({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="rgba(245,158,11,0.2)" stroke={C.amber} strokeWidth={1.6} strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
    </svg>
  );
}

function Lock({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={C.inkFaint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 018 0v3" />
    </svg>
  );
}

async function fetchPhoto(url?: string): Promise<string | null> {
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'RankYourPolitician-ShareCard/1.0' } });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5_000_000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 13, background: C.brand, alignItems: 'center', justifyContent: 'center' }}>
        <svg width="27" height="27" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14 }}>
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color: C.ink, letterSpacing: -0.5, lineHeight: 1.1 }}>RankYourPolitician</div>
        <div style={{ display: 'flex', fontSize: 17, fontWeight: 700, color: C.brandInk, marginTop: 2 }}>Know your leaders and hold them accountable.</div>
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        padding: 52,
        background: 'linear-gradient(140deg, #ffffff 0%, #f7f6ff 58%, #eef1ff 100%)',
        color: C.ink,
        fontFamily: 'Manrope, sans-serif',
      }}
    >
      {children}
    </div>
  );
}

type Tease = { label: string; value?: string; tone?: 'rating'; star?: boolean; redacted?: boolean };

// One "locked" tease: a quiet label over a blurred value + a lock. Real seed
// values are shown as blurred TEXT (present, unreadable - reveal on the site);
// the public rating has no seed value (it is live vote data we deliberately do
// not read here), so it renders a `redacted` blurred bar instead of inventing a
// number - the card must never fabricate a rating (CLAUDE.md rule 3).
function TeaseChip({ label, value, tone, star, redacted, last }: Tease & { last?: boolean }) {
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', padding: '15px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.92)', border: `1px solid ${C.line}`, marginRight: last ? 0 : 14 }}>
      <div style={{ display: 'flex', fontSize: 13, fontWeight: 800, letterSpacing: 1.1, color: C.inkFaint }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, height: 40 }}>
        {star ? <div style={{ display: 'flex', marginRight: 8 }}><Star size={24} /></div> : null}
        {redacted ? (
          <div style={{ display: 'flex', width: 92, height: 26, borderRadius: 8, background: tone === 'rating' ? 'rgba(180,83,9,0.45)' : 'rgba(28,32,42,0.4)', filter: 'blur(6px)' }} />
        ) : (
          <div style={{ display: 'flex', fontSize: 31, fontWeight: 800, color: tone === 'rating' ? C.ratingInk : C.ink, filter: 'blur(7px)' }}>{value}</div>
        )}
        <div style={{ display: 'flex', marginLeft: 12 }}><Lock size={19} /></div>
      </div>
    </div>
  );
}

const IMAGE_HEADERS = {
  'cache-control': 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=604800',
};

async function render(el: React.ReactElement) {
  const fonts = await loadFonts();
  return new ImageResponse(el, { width: WIDTH, height: HEIGHT, headers: IMAGE_HEADERS, ...(fonts ? { fonts } : {}) });
}

function fallbackCard() {
  return (
    <Frame>
      <Wordmark />
      <div style={{ display: 'flex', flexDirection: 'column', margin: 'auto 0', maxWidth: 960 }}>
        <div style={{ display: 'flex', fontSize: 58, fontWeight: 800, color: C.ink, letterSpacing: -1 }}>Know your representatives.</div>
        <div style={{ display: 'flex', marginTop: 12, fontSize: 28, color: C.inkSoft }}>Their office, record and responsibilities - so you can take real action.</div>
      </div>
      <div style={{ display: 'flex', fontSize: 25, fontWeight: 800, color: C.brandInk }}>rankyourpolitician.com</div>
    </Frame>
  );
}

function moneyShort(v?: string): string {
  if (!v) return '';
  const m = v.match(/\(([^)]+)\)/);
  const s = (m ? m[1] : v.split('(')[0]).replace(/~/g, '').trim();
  return s.length > 12 ? s.slice(0, 12) : s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let person;
  try {
    person = (await getPerson(id))?.person;
  } catch {
    person = undefined;
  }
  if (!person) return render(fallbackCard());

  const photo = await fetchPhoto(person.photo_url);
  const seat = [person.constituency, person.state].filter(Boolean).join(', ');
  const rateable = person.kind !== 'official';
  const name = person.name.length > 32 ? person.name.slice(0, 31).trimEnd() + '…' : person.name;
  const party = person.party ? (person.party.length > 30 ? person.party.slice(0, 28).trimEnd() + '…' : person.party) : null;

  // Intro: the office this person holds.
  const roleRaw =
    person.current_position ||
    (person.house ? HOUSE_ROLE[person.house] : '') ||
    (person.kind === 'official' ? (person.service ? `${person.service} · public office` : 'Appointed public office') : '');
  const role = roleRaw && roleRaw.length > 46 ? roleRaw.slice(0, 44).trimEnd() + '…' : roleRaw;

  // Blurred teases from the committed seed (facts + contact). No live reads.
  // Court-case counts are deliberately NOT teased here - see the header note.
  const wealthFact = person.facts.find((f) => f.field_type === 'assets_total');
  const rawContact = person.contact?.emails?.[0] || person.contact?.phones?.[0] || person.office_email || person.office_phone || '';
  const contact = rawContact ? (rawContact.length > 16 ? rawContact.slice(0, 16) : rawContact) : '';

  const teases: Tease[] = [];
  if (rateable) teases.push({ label: 'PUBLIC RATING', tone: 'rating', star: true, redacted: true });
  if (wealthFact) teases.push({ label: 'DECLARED WEALTH', value: moneyShort(wealthFact.value) || 'Rs' });
  if (contact) teases.push({ label: 'CONTACT', value: contact });

  return render(
    <Frame>
      {/* header: brand + tagline, credibility marker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Wordmark />
        <div style={{ display: 'flex', alignItems: 'center', padding: '9px 16px', borderRadius: 999, background: '#ffffff', border: `1px solid ${C.line}`, fontSize: 17, fontWeight: 700, color: C.inkSoft }}>
          Non-partisan · source-cited
        </div>
      </div>

      {/* intro + teases, vertically centred between header and footer */}
      <div style={{ display: 'flex', flexDirection: 'column', margin: 'auto 0' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} width={148} height={148} style={{ width: 148, height: 148, borderRadius: 28, objectFit: 'cover', border: '4px solid #ffffff', boxShadow: '0 10px 26px rgba(28,32,42,0.16)' }} alt="" />
        ) : (
          <div style={{ display: 'flex', width: 148, height: 148, borderRadius: 28, background: avatarTint(person.name), alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: 58, fontWeight: 800, border: '4px solid #ffffff', boxShadow: '0 10px 26px rgba(28,32,42,0.16)' }}>
            {initials(person.name)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 28, flex: 1 }}>
          {party ? (
            <div style={{ display: 'flex', alignSelf: 'flex-start', padding: '5px 14px', borderRadius: 999, background: C.paperSink, fontSize: 19, fontWeight: 700, color: C.inkSoft }}>{party}</div>
          ) : null}
          <div style={{ display: 'flex', marginTop: 9, fontSize: 52, fontWeight: 800, color: C.ink, letterSpacing: -1.4, lineHeight: 1.02 }}>{name}</div>
          {role ? <div style={{ display: 'flex', marginTop: 9, fontSize: 23, fontWeight: 700, color: C.brandInk }}>{role}</div> : null}
          {seat ? (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 7, fontSize: 21, color: C.inkFaint }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.brand} strokeWidth={2} strokeLinejoin="round" style={{ marginRight: 6 }}>
                <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {seat.length > 48 ? seat.slice(0, 46).trimEnd() + '…' : seat}
            </div>
          ) : null}
        </div>
      </div>

      {/* blurred teases - the details you reveal on the site */}
      {teases.length > 0 ? (
        <div style={{ display: 'flex', marginTop: 30 }}>
          {teases.map((tz, i) => (
            <TeaseChip key={tz.label} {...tz} last={i === teases.length - 1} />
          ))}
        </div>
      ) : null}
      </div>

      {/* footer: the personal hook + reveal CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: C.ink }}>
          {rateable ? 'I rated them - now you rate them too.' : 'See who this office answers to.'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 23, fontWeight: 800, color: C.brandInk }}>
          rankyourpolitician.com
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={C.brandInk} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 8 }}>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </div>
      </div>
    </Frame>,
  );
}
