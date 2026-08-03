import type { IconName } from '@/components/Icon';

// Registry for the civic guides under /guides. Following the /rights and
// /for-leaders pattern: PRESENTATION and CITATIONS live here in code (icons are
// not translatable; source URLs must never be corrupted by translation), while
// every word a reader sees is localised under `guides.items.<slug>` in the
// message files. `sectionIcons` is aligned by index to that slug's `sections`
// array. Sources were each checked to resolve on 2026-08-03 (eci.gov.in serves
// a 403 to non-browser agents but is the authoritative source and loads for
// real visitors - see the elections note in the repo memory).

export interface GuideSource {
  label: string;
  url: string;
  retrieved: string;
}

export interface GuideDef {
  slug: string;
  /** Hero / hub-card icon. */
  icon: IconName;
  /** Tailwind tint classes for the icon chip. */
  accent: string;
  /** Icons for each section, in the same order as the localised `sections`. */
  sectionIcons: IconName[];
  sources: GuideSource[];
}

export const GUIDES: GuideDef[] = [
  {
    slug: 'file-an-rti',
    icon: 'mail',
    accent: 'bg-brand-soft text-brand',
    sectionIcons: ['search', 'people', 'mail', 'wallet', 'clock', 'scales'],
    sources: [
      { label: 'RTI Online - Government of India', url: 'https://rtionline.gov.in/', retrieved: '2026-08-03' },
      { label: 'The Right to Information Act, 2005 - India Code', url: 'https://www.indiacode.nic.in/', retrieved: '2026-08-03' },
      { label: 'Central Information Commission', url: 'https://cic.gov.in/', retrieved: '2026-08-03' },
    ],
  },
  {
    slug: 'how-a-bill-becomes-law',
    icon: 'parliament',
    accent: 'bg-perf-soft text-perf',
    sectionIcons: ['flag', 'layers', 'people', 'parliament', 'check', 'building'],
    sources: [
      { label: 'Constitution of India (Articles 107-111, 196-201)', url: 'https://www.constitutionofindia.net/', retrieved: '2026-08-03' },
      { label: 'Parliament of India', url: 'https://sansad.in/', retrieved: '2026-08-03' },
      { label: 'PRS Legislative Research - the legislative process', url: 'https://prsindia.org/', retrieved: '2026-08-03' },
    ],
  },
  {
    slug: 'your-local-body',
    icon: 'building',
    accent: 'bg-rating-soft text-rating-ink',
    sectionIcons: ['building', 'people', 'check', 'x', 'megaphone'],
    sources: [
      { label: 'Ministry of Panchayati Raj', url: 'https://panchayat.gov.in/', retrieved: '2026-08-03' },
      { label: 'Ministry of Housing and Urban Affairs', url: 'https://mohua.gov.in/', retrieved: '2026-08-03' },
      { label: 'Constitution of India - 73rd & 74th Amendments, Eleventh & Twelfth Schedules', url: 'https://www.constitutionofindia.net/', retrieved: '2026-08-03' },
    ],
  },
  {
    slug: 'read-an-election-affidavit',
    icon: 'scales',
    accent: 'bg-accent-soft text-accent-ink',
    sectionIcons: ['law', 'wallet', 'scales', 'cap', 'search'],
    sources: [
      { label: 'Election Commission of India', url: 'https://www.eci.gov.in/', retrieved: '2026-08-03' },
      { label: 'MyNeta - candidate affidavits (ADR)', url: 'https://myneta.info/', retrieved: '2026-08-03' },
      { label: 'Association for Democratic Reforms', url: 'https://adrindia.org/', retrieved: '2026-08-03' },
    ],
  },
];

export const GUIDE_SLUGS = GUIDES.map((g) => g.slug);
export const GUIDE_BY_SLUG = new Map(GUIDES.map((g) => [g.slug, g] as const));
