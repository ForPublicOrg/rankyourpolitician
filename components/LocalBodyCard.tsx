import Link from 'next/link';
import type { LocalBody } from '@/lib/types';
import { localChairs, localPersonId, localRoleTitle } from '@/lib/local-bodies';
import { formatDate } from '@/lib/format';
import { Avatar, PartyChip, Chip } from './ui';
import Icon from './Icon';

type Tr = (k: string, v?: Record<string, string | number>) => string;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * One city government: the body, its elected head (or the fact that an
 * Administrator holds charge), the deputy and the commissioner where the
 * body's own site names them - each name a link to its info-only profile,
 * each with the citation it came from. Server component; used on the /local
 * hub, the state page and the district page.
 */
export default function LocalBodyCard({ body, tr, locale, compact }: { body: LocalBody; tr: Tr; locale: string; compact?: boolean }) {
  const chairs = localChairs(body);
  return (
    <div id={body.id} className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{tr(`local.kind.${body.kind}`)}</p>
          <h3 className="mt-0.5 font-bold text-ink">{body.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1">
              <Icon name="pin" size={12} /> {body.city}
              {body.districts[0] && (
                <>
                  {' · '}
                  <Link href={`/district/${body.stateCode}/${encodeURIComponent(body.districts[0])}`} className="hover:text-brand hover:underline">
                    {tr('local.districtIn', { district: body.districts[0] })}
                  </Link>
                </>
              )}
            </span>
          </p>
        </div>
        {body.website && (
          <a
            href={body.website}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand hover:bg-brand hover:text-white"
          >
            <Icon name="external" size={12} /> {hostOf(body.website)}
          </a>
        )}
      </div>

      {body.status === 'administrator' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-ink">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-rating-ink" />
          <span>
            {tr('local.administrator')}
            {body.status_note && <span className="block text-ink-soft">{body.status_note}</span>}
          </span>
        </p>
      )}

      {chairs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {chairs.map(({ role, person }) => {
            const href = person.politicianId ? `/person/${person.politicianId}` : `/person/${localPersonId(body, role, person)}`;
            return (
              <li key={role}>
                <Link
                  href={href}
                  className="pressable flex items-center gap-3 rounded-2xl border border-line/70 bg-paper-soft/60 p-2.5 hover:border-brand/40 hover:shadow-soft"
                >
                  <Avatar name={person.name} size={compact ? 36 : 44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-ink">{person.name}</span>
                      {person.party && <PartyChip party={person.party} />}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                      <Chip tone={role === 'commissioner' ? 'neutral' : 'brand'} icon={role === 'commissioner' ? 'shield' : 'home'}>
                        {localRoleTitle(body, role)}
                      </Chip>
                      {person.since && <span>{tr('local.since')} {formatDate(person.since, locale)}</span>}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="-rotate-90 shrink-0 text-ink-faint" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
        <a href={body.head?.source_url || body.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand hover:underline">
          <Icon name="link" size={12} /> {tr('common.source')}: {body.head?.source_name || body.source_name}
        </a>
        <span>· {tr('common.lastUpdated')} {formatDate(body.head?.retrieved_date || body.retrieved_date, locale)}</span>
      </p>
    </div>
  );
}
