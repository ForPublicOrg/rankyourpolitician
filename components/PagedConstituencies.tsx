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
  const visible = items.slice(start, start + pageSize);

  return (
    <div>
      <ul className="space-y-1.5 text-sm">
        {visible.map((c) => (
          <li key={c.id}>
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
