import type { MetadataRoute } from 'next';
import { getAllPersonIds, getIndex, getStates, getDistrictsInState } from '@/lib/data';
import { SITE_URL } from '@/lib/site-url';

// Built once per deploy. Clean (locale-less) URLs are the canonical ones -
// middleware picks the reader's language, so one URL serves every locale.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [idx, states, personIds] = await Promise.all([getIndex(), getStates(), getAllPersonIds()]);

  // Declared cadence: hub pages daily (they carry revalidate=86400), the rest
  // weekly - a conservative hint for the prose pages, which only change on
  // deploy. NB Google documents that it ignores <changefreq>; the honest values
  // are for other crawlers, and the actual ISR-write savings come from the
  // revalidate windows and robots.ts, not from this file.
  const urls: MetadataRoute.Sitemap = [
    ...['', '/india', '/hierarchy', '/rankings'].map((p) => ({
      url: `${SITE_URL}${p || '/'}`,
      changeFrequency: 'daily' as const,
    })),
    ...['/rights', '/who', '/accountability', '/about', '/methodology', '/grievance', '/privacy', '/terms'].map((p) => ({
      url: `${SITE_URL}${p}`,
      changeFrequency: 'weekly' as const,
    })),
  ];

  for (const s of states) {
    urls.push({ url: `${SITE_URL}/state/${s.stateCode}`, changeFrequency: 'weekly' });
    for (const d of await getDistrictsInState(s.stateCode)) {
      urls.push({ url: `${SITE_URL}/district/${s.stateCode}/${encodeURIComponent(d)}`, changeFrequency: 'weekly' });
    }
  }
  for (const c of idx.constituencies) {
    urls.push({ url: `${SITE_URL}/area/${c.id}`, changeFrequency: 'weekly' });
  }
  for (const id of personIds) {
    urls.push({ url: `${SITE_URL}/person/${id}`, changeFrequency: 'weekly' });
  }
  return urls;
}
