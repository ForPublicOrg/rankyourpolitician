// One <urlset> per section (core, states, districts, areas, people, audits,
// elections - chunked where a section is large). The index at /sitemap.xml
// lists them; lib/sitemap.ts builds them.
//
// The `.xml` lives in the param rather than in a nested folder so one handler
// covers every segment: middleware skips any path containing a dot, so these
// never get locale-rewritten.
import { sitemapSegments, urlsetXml } from '@/lib/sitemap';

export const dynamic = 'force-static';
// Only the segments that actually exist; anything else 404s at the router
// instead of rendering an empty urlset.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ segment: string }[]> {
  return (await sitemapSegments()).map((s) => ({ segment: `${s.id}.xml` }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ segment: string }> }): Promise<Response> {
  const { segment } = await ctx.params;
  const id = segment.replace(/\.xml$/, '');
  const found = (await sitemapSegments()).find((s) => s.id === id);
  if (!found) return new Response('Not found', { status: 404 });
  return new Response(urlsetXml(found.urls), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
