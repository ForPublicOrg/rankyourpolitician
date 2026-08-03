'use client';

// A code-rendered flag keeps the official 3:2 construction and 24-spoke
// Chakra sharp at every size, without adding an image request to the homepage.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/lib/i18n/provider';
import Icon from './Icon';

const FLAG_SOURCE_URL = 'https://knowindia.india.gov.in/my-india-my-pride/indian-tricolor.php';
const SPOKES = Array.from({ length: 24 }, (_, i) => i * 15);
type FlagPart = 'structure' | 'saffron' | 'white' | 'green' | 'chakra';

const WIND_FRAMES = {
  saffron: [
    'M0 0H300V66.667C250 64 215 69 170 66.667C120 64 60 69 0 66.667Z',
    'M0 0H300V66.667C250 68.2 215 65.1 170 66.667C120 68.2 60 65.1 0 66.667Z',
    'M0 0H300V66.667C250 64.7 215 68.1 170 66.667C120 64.7 60 68.1 0 66.667Z',
    'M0 0H300V66.667C250 64 215 69 170 66.667C120 64 60 69 0 66.667Z',
  ],
  white: [
    'M0 66.667C60 69 120 64 170 66.667C215 69 250 64 300 66.667V133.333C250 130 215 136 170 133.333C120 130 60 136 0 133.333Z',
    'M0 66.667C60 65.1 120 68.2 170 66.667C215 65.1 250 68.2 300 66.667V133.333C250 135.2 215 131.3 170 133.333C120 135.2 60 131.3 0 133.333Z',
    'M0 66.667C60 68.1 120 64.7 170 66.667C215 68.1 250 64.7 300 66.667V133.333C250 131.2 215 135.4 170 133.333C120 131.2 60 135.4 0 133.333Z',
    'M0 66.667C60 69 120 64 170 66.667C215 69 250 64 300 66.667V133.333C250 130 215 136 170 133.333C120 130 60 136 0 133.333Z',
  ],
  green: [
    'M0 133.333C60 136 120 130 170 133.333C215 136 250 130 300 133.333V200H0Z',
    'M0 133.333C60 131.3 120 135.2 170 133.333C215 131.3 250 135.2 300 133.333V200H0Z',
    'M0 133.333C60 135.4 120 131.2 170 133.333C215 135.4 250 131.2 300 133.333V200H0Z',
    'M0 133.333C60 136 120 130 170 133.333C215 136 250 130 300 133.333V200H0Z',
  ],
};

function WindBand({ color, frames, part }: { color: string; frames: readonly string[]; part: FlagPart }) {
  return (
    <path className={`india-flag-band india-flag-band--${part}`} d={frames[0]} fill={color}>
      <animate
        attributeName="d"
        dur="7.2s"
        repeatCount="indefinite"
        calcMode="spline"
        keyTimes="0;0.32;0.68;1"
        keySplines="0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1"
        values={frames.join(';')}
      />
    </path>
  );
}

function NationalFlag({
  className,
  label,
  wind = false,
  activePart,
}: {
  className?: string;
  label?: string;
  wind?: boolean;
  activePart?: FlagPart | null;
}) {
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
            <stop offset="0.2" stopColor="#000" stopOpacity="0.07" />
            <stop offset="0.36" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="0.56" stopColor="#000080" stopOpacity="0.07" />
            <stop offset="0.76" stopColor="#fff" stopOpacity="0.14" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {/* The Flag Code specifies three equal horizontal bands in a 3:2 flag. */}
      <g className={wind ? 'india-flag-wind' : undefined} data-highlight={activePart || undefined}>
        {wind ? (
          <>
            <WindBand color="#FF9933" frames={WIND_FRAMES.saffron} part="saffron" />
            <WindBand color="#FFFFFF" frames={WIND_FRAMES.white} part="white" />
            <WindBand color="#138808" frames={WIND_FRAMES.green} part="green" />
          </>
        ) : (
          <>
            <rect className="india-flag-band india-flag-band--saffron" width="300" height="66.6667" fill="#FF9933" />
            <rect className="india-flag-band india-flag-band--white" y="66.6667" width="300" height="66.6667" fill="#FFFFFF" />
            <rect className="india-flag-band india-flag-band--green" y="133.3333" width="300" height="66.6667" fill="#138808" />
          </>
        )}
        {/* The Chakra's diameter matches the white band. Each radial is one of its 24 spokes. */}
        <g className={wind ? 'india-flag-chakra-wind' : undefined} fill="none" stroke="#000080" strokeWidth="1.65">
          <circle cx="150" cy="100" r="32.5" />
          {SPOKES.map((angle) => (
            <line key={angle} x1="150" y1="100" x2="150" y2="67.5" transform={`rotate(${angle} 150 100)`} />
          ))}
        </g>
        <circle className="india-flag-chakra-core" cx="150" cy="100" r="1.85" fill="#000080" />
      </g>
      {wind && <rect className="india-flag-wind__sheen" width="300" height="200" fill={`url(#${sheenId})`} />}
    </svg>
  );
}

type Detail = {
  key: FlagPart;
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
  const [selectedPart, setSelectedPart] = useState<FlagPart | null>(null);
  const [previewPart, setPreviewPart] = useState<FlagPart | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    setPreviewPart(null);
    setSelectedPart(null);
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
          <span className="india-flag-trigger__mast" aria-hidden="true" />
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
                <div className="india-flag-stage__flag-wrap">
                  <span className="india-flag-stage__mast" aria-hidden="true"><span /></span>
                  <div className="india-flag-stage__flag">
                    <NationalFlag
                      className="india-flag-stage__art"
                      label={t('home.flag.flagAria')}
                      wind
                      activePart={previewPart || selectedPart}
                    />
                  </div>
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
                <p className="india-flag-interaction-hint">
                  <span aria-hidden="true" /> {t('home.flag.interactionHint')}
                </p>

                <div className="india-flag-details" aria-label={t('home.flag.anatomyTitle')}>
                  {DETAILS.map((detail, index) => (
                    <button
                      type="button"
                      key={detail.key}
                      className={`india-flag-detail ${detail.tone}`}
                      data-active={(previewPart || selectedPart) === detail.key || undefined}
                      aria-pressed={selectedPart === detail.key}
                      style={{ '--flag-delay': `${120 + index * 85}ms` } as CSSProperties}
                      onPointerEnter={() => setPreviewPart(detail.key)}
                      onPointerLeave={() => setPreviewPart(null)}
                      onFocus={() => setPreviewPart(detail.key)}
                      onBlur={() => setPreviewPart(null)}
                      onClick={() => {
                        setPreviewPart(null);
                        setSelectedPart((current) => current === detail.key ? null : detail.key);
                      }}
                    >
                      <span className="india-flag-detail__mark" aria-hidden="true" />
                      <div>
                        <h3>{t(`home.flag.details.${detail.key}.title`)}</h3>
                        <p>{t(`home.flag.details.${detail.key}.body`)}</p>
                      </div>
                    </button>
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
