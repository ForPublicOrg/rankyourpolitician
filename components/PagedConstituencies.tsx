'use client';
import { useState } from 'react';
import Link from 'next/link';
import Pager from './Pager';
import { constituencyHref } from '@/lib/locality';

type Item = { id: string; name: string; type: 'PC' | 'AC' | 'RS' | 'MLC'; stateCode: string; districts: string[] };

/** Paginated list of a state's constituencies (a big state has 80). */
export default function PagedConstituencies({ items, pageSize = 15 }: { items: Item[]; pageSize?: number }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.ceil(items.length / pageSize);
  const start = (page - 1) * pageSize;

  // EVERY constituency is rendered into the DOM; the pager only hides the ones
  // off the current page. Slicing before render meant a state page shipped 15
  // links out of up to 483, so /area pages were reachable only from their
  // district page - and the ~340 seats whose district we cannot map had no
  // internal link at all and lived in the sitemap alone, which is close to
  // invisible to a crawler. This costs no extra data (the full list is already
  // in the RSC payload as this component's props), only the HTML for the links,
  // and it puts every seat one hop from its state page.
  //
  // gap, not space-y: `space-y-*` margins the second child onwards, so a hidden
  // first item would leave a stray gap at the top of pages 2+. Flex `gap` skips
  // display:none children.
  return (
    <div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {items.map((c, i) => (
          <li key={c.id} hidden={i < start || i >= start + pageSize}>
            <Link href={constituencyHref(c)} className="text-brand hover:underline">
              {c.name}
            </Link>
            <span className="text-ink-faint"> · {c.type}</span>
          </li>
        ))}
      </ul>
      <Pager page={page} pageCount={pageCount} onPage={setPage} total={items.length} pageSize={pageSize} />
    </div>
  );
}
