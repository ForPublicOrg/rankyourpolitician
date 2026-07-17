import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE, LOCALE_CODES } from '@/lib/i18n/locales';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  // /{locale}/... URLs are middleware-rewrite targets, not real destinations:
  // locale is cookie-picked, readers never see prefixed URLs, and there is no
  // hreflang strategy. Left crawlable they are ~244k duplicate URLs whose every
  // fetch is an on-demand ISR render (a billed write + origin transfer each).
  // Blocking both `/xx/` (subpaths) and `/xx$` (the bare locale home; plain
  // `/xx` would also block /hierarchy et al.) stops that crawl spend. The
  // trade-off is deliberate: a robots-blocked URL is never fetched, so the
  // canonical tags on blocked variants are invisible - a prefixed URL that was
  // already indexed via an external link freezes as a URL-only entry rather
  // than consolidating. /en/ stays crawlable on purpose: it is the prefix most
  // likely to collect external links, and leaving it fetchable lets its
  // canonicals collapse those duplicates into the clean URLs.
  const localePrefixes = LOCALE_CODES.filter((c) => c !== DEFAULT_LOCALE).flatMap((c) => [`/${c}/`, `/${c}$`]);
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', ...localePrefixes] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
