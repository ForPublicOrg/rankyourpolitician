import Link from 'next/link';
import { SITE_URL } from '@/lib/site-url';
import JsonLd from './JsonLd';

export default function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  // BreadcrumbList emitted from the component that draws the trail, so the
  // structured data and the visible trail can never drift apart - every page
  // with breadcrumbs gets it, and no page has to remember to add it. Google
  // wants absolute URLs here; the last crumb is the current page and carries no
  // `item`, which is exactly how the visible trail renders it too.
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.label,
      ...(it.href && i < items.length - 1 ? { item: `${SITE_URL}${it.href}` } : {}),
    })),
  };

  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <JsonLd data={crumbs} />
      <ol className="flex flex-wrap items-center gap-1 text-ink-faint">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {it.href && !last ? (
                <Link href={it.href} className="hover:text-brand">
                  {it.label}
                </Link>
              ) : (
                <span className={last ? 'text-ink-soft' : ''} aria-current={last ? 'page' : undefined}>
                  {it.label}
                </span>
              )}
              {!last && <span aria-hidden="true">›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
