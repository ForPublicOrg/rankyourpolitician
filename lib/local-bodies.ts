// Pure helpers for urban local bodies (city governments) - shared by the data
// layer, the build-time search index and the pages. No I/O, no seed import:
// the seed is read where it is needed (lib/data.ts at runtime, the tools at
// build time) so this module stays safe to import from either side.
import type { LocalBody, LocalBodyPerson } from './types';

/** Which chair on a local body a profile is about. */
export type LocalRole = 'head' | 'deputy_head' | 'commissioner';

export function slugifyLocal(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const ROLE_SLUG: Record<LocalRole, (body: LocalBody) => string> = {
  head: (b) => slugifyLocal(b.head_title) || 'head',
  deputy_head: (b) => `deputy-${slugifyLocal(b.head_title) || 'head'}`,
  commissioner: () => 'commissioner',
};

/** Stable profile id for a chair on a local body: "mh-pune-mayor-{name}".
 *  Carries the body and the role so two cities' mayors of one name never
 *  collide, and a mayor and a commissioner of one name never merge. */
export function localPersonId(body: LocalBody, role: LocalRole, person: LocalBodyPerson): string {
  return `${body.id}-${ROLE_SLUG[role](body)}-${slugifyLocal(person.name)}`;
}

/** The chair's title in the body's own words: "Mayor", "Deputy Mayor",
 *  "Municipal Commissioner". */
export function localRoleTitle(body: LocalBody, role: LocalRole): string {
  if (role === 'head') return body.head_title;
  if (role === 'deputy_head') return `Deputy ${body.head_title}`;
  return body.commissioner?.title || 'Municipal Commissioner';
}

/** Every named chair on a body, in display order. */
export function localChairs(body: LocalBody): { role: LocalRole; person: LocalBodyPerson }[] {
  const out: { role: LocalRole; person: LocalBodyPerson }[] = [];
  if (body.head) out.push({ role: 'head', person: body.head });
  if (body.deputy_head) out.push({ role: 'deputy_head', person: body.deputy_head });
  if (body.commissioner) out.push({ role: 'commissioner', person: body.commissioner });
  return out;
}
