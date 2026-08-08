// The sitemap index - the one URL robots.txt points at, and the one to submit
// in Search Console. It lists the per-section segments served by
// app/sitemaps/[segment]; see lib/sitemap.ts for why the sitemap is split.
//
// force-static: prerendered into the deploy like every page here, so a crawler
// fetching it is a CDN hit and not a function invocation. The contents change
// only when the seed does, i.e. only on deploy.
import { sitemapIndexXml, sitemapSegments } from '@/lib/sitemap';

export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const segments = await sitemapSegments();
  return new Response(sitemapIndexXml(segments), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
