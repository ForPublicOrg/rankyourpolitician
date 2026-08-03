'use client';

// A code-rendered flag keeps the official 3:2 construction and 24-spoke
// Chakra sharp at every size, without adding an image request to the homepage.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n/provider';
import Icon from './Icon';

const FLAG_SOURCE_URL = 'https://knowindia.india.gov.in/my-india-my-pride/indian-tricolor.php';
const SPOKES = Array.from({ length: 24 }, (_, i) => i * 15);
const WIND_FRAMES = {
  saffron: [
    'M0 0H300V66.667C250 64 215 69 170 66.667C120 64 60 69 0 66.667Z',
    'M0 0H300V66.667C250 70 215 63 170 66.667C120 70 60 63 0 66.667Z',
    'M0 0H300V66.667C250 62 215 68 170 66.667C120 62 60 68 0 66.667Z',
    'M0 0H300V66.667C250 64 215 69 170 66.667C120 64 60 69 0 66.667Z',
  ],
  white: [
    'M0 66.667C60 69 120 64 170 66.667C215 69 250 64 300 66.667V133.333C250 130 215 136 170 133.333C120 130 60 136 0 133.333Z',
    'M0 66.667C60 63 120 70 170 66.667C215 63 250 70 300 66.667V133.333C250 137 215 129 170 133.333C120 137 60 129 0 133.333Z',
    'M0 66.667C60 68 120 62 170 66.667C215 68 250 62 300 66.667V133.333C250 129 215 137 170 133.333C120 129 60 137 0 133.333Z',
    'M0 66.667C60 69 120 64 170 66.667C215 69 250 64 300 66.667V133.333C250 130 215 136 170 133.333C120 130 60 136 0 133.333Z',
  ],
  green: [
    'M0 133.333C60 136 120 130 170 133.333C215 136 250 130 300 133.333V200H0Z',
    'M0 133.333C60 129 120 137 170 133.333C215 129 250 137 300 133.333V200H0Z',
    'M0 133.333C60 137 120 129 170 133.333C215 137 250 129 300 133.333V200H0Z',
    'M0 133.333C60 136 120 130 170 133.333C215 136 250 130 300 133.333V200H0Z',
  ],
};

function WindBand({ color, frames }: { color: string; frames: readonly string[] }) {
  return (
    <path d={frames[0]} fill={color}>
      <animate
        attributeName="d"
        dur="4.8s"
        repeatCount="indefinite"
        calcMode="spline"
        keyTimes="0;0.32;0.68;1"
        keySplines="0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1"
        values={frames.join(';')}
      />
    </path>
  );
}

function NationalFlag({ className, label, wind = false }: { className?: string; label?: string; wind?: boolean }) {
  const titleId = useId();
  const sheenId = `india-flag-sheen-${useId().replace(/:/g, '')}`;

  return (
    <svg
      viewBox="0 0 300 200"
      className={className}
      role="img"
      aria-labelledby={label ? titleId : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label && <title id={titleId}>{label}</title>}
      {wind && (
        <defs>
          <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.46" stopColor="#fff" stopOpacity="0.18" />
            <stop offset="0.58" stopColor="#000080" stopOpacity="0.08" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {/* The Flag Code specifies three equal horizontal bands in a 3:2 flag. */}
      <g className={wind ? 'india-flag-wind' : undefined}>
        {wind ? (
          <>
            <WindBand color="#FF9933" frames={WIND_FRAMES.saffron} />
            <WindBand color="#FFFFFF" frames={WIND_FRAMES.white} />
            <WindBand color="#138808" frames={WIND_FRAMES.green} />
          </>
        ) : (
          <>
            <rect width="300" height="66.6667" fill="#FF9933" />
            <rect y="66.6667" width="300" height="66.6667" fill="#FFFFFF" />
            <rect y="133.3333" width="300" height="66.6667" fill="#138808" />
          </>
        )}
        {/* The Chakra's diameter matches the white band. Each radial is one of its 24 spokes. */}
        <g className={wind ? 'india-flag-chakra-wind' : undefined} fill="none" stroke="#000080" strokeWidth="1.65">
          <circle cx="150" cy="100" r="32.5" />
          {SPOKES.map((angle) => (
            <line key={angle} x1="150" y1="100" x2="150" y2="67.5" transform={`rotate(${angle} 150 100)`} />
          ))}
        </g>
        <circle cx="150" cy="100" r="1.85" fill="#000080" />
      </g>
      {wind && <rect className="india-flag-wind__sheen" width="300" height="200" fill={`url(#${sheenId})`} />}
    </svg>
  );
}

type Detail = {
  key: 'structure' | 'saffron' | 'white' | 'green' | 'chakra';
  tone: string;
};

const DETAILS: Detail[] = [
  { key: 'structure', tone: 'india-flag-detail--structure' },
  { key: 'saffron', tone: 'india-flag-detail--saffron' },
  { key: 'white', tone: 'india-flag-detail--white' },
  { key: 'green', tone: 'india-flag-detail--green' },
  { key: 'chakra', tone: 'india-flag-detail--chakra' },
];

export default function IndiaFlagExplainer() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  // Render the full-page layer at <body>, rather than inside the map's motion
  // wrapper. A transformed ancestor changes the containing block for `fixed`
  // descendants and would otherwise trap the dialog inside the map column.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="india-flag-trigger pressable group"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('home.flag.open')}
      >
        <span className="india-flag-trigger__frame">
          <NationalFlag className="india-flag-trigger__art" wind />
        </span>
        <span className="india-flag-trigger__label">{t('home.flag.label')}</span>
        <span className="india-flag-trigger__hint">{t('home.flag.hint')}</span>
      </button>

      {mounted && open && createPortal(
        <div
          className="india-flag-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="india-flag-title"
            className="india-flag-dialog"
          >
            <header className="india-flag-dialog__header">
              <p className="india-flag-dialog__eyebrow">
                <span className="tricolor-line w-9" aria-hidden="true" />
                {t('home.flag.eyebrow')}
              </p>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="pressable inline-flex items-center gap-2 rounded-full border border-line bg-paper/90 px-3.5 py-2 text-sm font-semibold text-ink shadow-soft hover:border-brand/35 hover:text-brand"
              >
                <Icon name="x" size={17} />
                {t('home.flag.close')}
              </button>
            </header>

            <div className="india-flag-dialog__content">
              <div className="india-flag-stage">
                <div className="india-flag-stage__signal" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="india-flag-stage__flag">
                  <NationalFlag className="india-flag-stage__art" label={t('home.flag.flagAria')} wind />
                </div>
                <dl className="india-flag-measures" aria-label={t('home.flag.structureTitle')}>
                  <div>
                    <dt>{t('home.flag.measureRatio')}</dt>
                    <dd>2 : 3</dd>
                  </div>
                  <div>
                    <dt>{t('home.flag.measureBands')}</dt>
                    <dd>3</dd>
                  </div>
                  <div>
                    <dt>{t('home.flag.measureSpokes')}</dt>
                    <dd>24</dd>
                  </div>
                </dl>
              </div>

              <div className="min-w-0">
                <h2 id="india-flag-title" className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                  {t('home.flag.title')}
                </h2>
                <p className="mt-3 max-w-2xl text-base leading-7 text-ink-soft sm:text-lg">
                  {t('home.flag.intro')}
                </p>

                <div className="india-flag-details" aria-label={t('home.flag.anatomyTitle')}>
                  {DETAILS.map((detail, index) => (
                    <article
                      key={detail.key}
                      className={`india-flag-detail ${detail.tone}`}
                      style={{ '--flag-delay': `${120 + index * 85}ms` } as CSSProperties}
                    >
                      <span className="india-flag-detail__mark" aria-hidden="true" />
                      <div>
                        <h3>{t(`home.flag.details.${detail.key}.title`)}</h3>
                        <p>{t(`home.flag.details.${detail.key}.body`)}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="india-flag-history">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-ink-faint">{t('home.flag.historyEyebrow')}</p>
                <h3 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink">{t('home.flag.historyTitle')}</h3>
              </div>
              <ol className="india-flag-timeline">
                {['adopted', 'independence', 'republic', 'code'].map((event, index) => (
                  <li key={event} style={{ '--flag-delay': `${260 + index * 90}ms` } as CSSProperties}>
                    <time>{t(`home.flag.history.${event}.date`)}</time>
                    <p>{t(`home.flag.history.${event}.body`)}</p>
                  </li>
                ))}
              </ol>
            </div>

            <footer className="india-flag-dialog__footer">
              <p>
                <strong>{t('home.flag.respectTitle')}</strong> {t('home.flag.respectBody')}
              </p>
              <a
                href={FLAG_SOURCE_URL}
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-brand-deep"
              >
                {t('home.flag.sourceCta')} <Icon name="external" size={15} />
              </a>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
