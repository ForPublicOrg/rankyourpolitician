'use client';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import Icon, { type IconName } from './Icon';

// The accountability ladder: National → State → District → Area.
// A compact teaser of the full org chart (/hierarchy).
export default function HierarchyLadder({ current }: { current?: 'national' | 'state' | 'district' | 'area' }) {
  const { t } = useI18n();
  const steps: { key: 'national' | 'state' | 'district' | 'area'; icon: IconName; href: string; tint: string }[] = [
    { key: 'national', icon: 'parliament', href: '/india', tint: 'bg-brand-soft text-brand' },
    { key: 'state', icon: 'flag', href: '/hierarchy', tint: 'bg-perf-soft text-perf' },
    { key: 'district', icon: 'shield', href: '/hierarchy', tint: 'bg-rating-soft text-rating-ink' },
    { key: 'area', icon: 'pin', href: '/hierarchy', tint: 'bg-paper-sink text-ink-soft' },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-stretch sm:gap-0">
      {steps.map((s, i) => (
        <div key={s.key} className="contents">
          <Link href={s.href} className="block">
            <div
              className={`pressable flex h-full items-center gap-3 rounded-2xl p-3.5 glass ${
                current === s.key ? 'ring-2 ring-brand/40' : ''
              } transition hover:shadow-lift`}
            >
              <span className={`inline-grid h-10 w-10 shrink-0 place-items-center rounded-xl ${s.tint}`}>
                <Icon name={s.icon} size={22} />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                  {i + 1}. {t(`hierarchy.${s.key}`)}
                </p>
                <p className="truncate text-sm font-medium text-ink">{t(`hierarchy.${s.key}Who`)}</p>
              </div>
            </div>
          </Link>
          {i < steps.length - 1 && (
            <div className="hidden items-center justify-center px-1 py-0.5 text-brand/50 sm:flex" aria-hidden="true">
              <Icon name="chevron" size={18} className="-rotate-90" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
