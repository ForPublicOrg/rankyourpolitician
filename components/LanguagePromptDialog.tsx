'use client';
// The first-visit language dialog. LanguagePrompt.tsx decides WHEN it opens
// and loads this file lazily. It is a native <dialog> opened with showModal():
// the browser makes the page behind it inert, keeps focus inside, and turns
// Esc or the Android back gesture into a close - no hand-rolled focus trap.
// Every way out (Esc, the X, a backdrop tap, "Continue") ends in finish() and
// counts as an answer, so it is asked only once.
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { LOCALES, LOCALE_MAP } from '@/lib/i18n/locales';
import { useI18n } from '@/lib/i18n/provider';
import Icon from './Icon';
import { rememberLocale, showLocale } from './LanguageSwitcher';

/** Our locales that the browser lists as preferred, best first (hi-IN -> hi).
 *  Read on the device only to order the list; never stored or sent. */
function browserLocales(): string[] {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  const out: string[] = [];
  for (const tag of tags) {
    const code = tag?.toLowerCase().split('-')[0];
    if (code && LOCALE_MAP[code] && !out.includes(code)) out.push(code);
  }
  return out;
}

export default function LanguagePromptDialog({ onDone }: { onDone: () => void }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const backdropPress = useRef(false);
  const finished = useRef(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The browser's preferred languages first; the rest keep the switcher's
  // order (English, then by number of speakers).
  const ordered = useMemo(() => {
    const preferred = browserLocales();
    const rank = (code: string) => {
      const i = preferred.indexOf(code);
      return i === -1 ? preferred.length : i;
    };
    return [...LOCALES].sort((a, b) => rank(a.code) - rank(b.code));
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Strict Mode runs this twice in dev, and showModal() throws when open.
    if (!dialog.open) dialog.showModal();
    firstRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Settled synchronously rather than from the dialog's close event: Chromium
  // dispatches that on the next animation frame, which never comes in a tab
  // that is not painting. The event still covers Esc and the back gesture.
  function finish() {
    if (finished.current) return;
    finished.current = true;
    // A plain dismissal keeps the language on screen, and is remembered too.
    if (!switchingTo) rememberLocale(locale);
    if (dialogRef.current?.open) dialogRef.current.close();
    onDone();
  }

  // A language switch normally replaces this whole tree. If the refresh
  // settles and we are somehow still here, close rather than spin forever.
  useEffect(() => {
    if (switchingTo && !pending) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchingTo, pending]);

  function choose(code: string) {
    if (switchingTo) return;
    if (code === locale) {
      finish();
      return;
    }
    rememberLocale(code);
    // Stay open, with a spinner on the choice, until the page has re-rendered
    // in the new language - that swaps out this whole tree, dialog included.
    setSwitchingTo(code);
    showLocale(() => startTransition(() => router.refresh()));
  }

  return (
    <dialog
      ref={dialogRef}
      className="lang-prompt"
      aria-labelledby="lang-prompt-title"
      aria-describedby="lang-prompt-hint"
      onClose={finish}
      // Only a tap that starts AND ends on the backdrop closes: a drag out of
      // the panel (e.g. scrolling the list) must not dismiss it.
      onPointerDown={(e) => {
        backdropPress.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (backdropPress.current && e.target === e.currentTarget) finish();
      }}
    >
      <div className="lang-prompt__panel glass-overlay">
        <div className="flex items-start gap-3 px-4 pb-3 pt-5 sm:px-6 sm:pt-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Icon name="globe" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="lang-prompt-title"
              className="font-display text-lg font-extrabold leading-tight tracking-tight text-ink sm:text-xl"
            >
              {t('langPrompt.title')}
            </h2>
            <p id="lang-prompt-hint" className="mt-1 text-sm leading-snug text-ink-soft">
              {t('langPrompt.hint')}
            </p>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label={t('langPrompt.close')}
            className="pressable -me-1.5 -mt-1.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-paper-sink hover:text-ink"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <ul
          className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto overscroll-contain px-4 py-1 sm:grid-cols-4 sm:px-6"
          aria-busy={switchingTo ? true : undefined}
        >
          {ordered.map((l, i) => {
            const current = l.code === locale;
            const busy = switchingTo === l.code;
            return (
              <li key={l.code} className="min-w-0">
                <button
                  ref={i === 0 ? firstRef : undefined}
                  type="button"
                  onClick={() => choose(l.code)}
                  aria-current={current ? 'true' : undefined}
                  aria-disabled={switchingTo ? true : undefined}
                  className={clsx(
                    'pressable relative flex h-full min-h-[3.25rem] w-full min-w-0 flex-col items-start justify-center rounded-xl border px-2.5 py-2 text-start transition-colors',
                    current || busy
                      ? 'border-brand/50 bg-brand-soft pe-6'
                      : 'border-line bg-paper hover:border-brand/40 hover:bg-brand-soft/60',
                  )}
                >
                  <span
                    lang={l.code}
                    dir={l.dir ?? 'ltr'}
                    className="max-w-full break-words text-[15px] font-semibold leading-snug text-ink"
                  >
                    {l.native}
                  </span>
                  {l.native !== l.english && (
                    <span className="max-w-full text-[11px] leading-tight text-ink-faint">{l.english}</span>
                  )}
                  {busy ? (
                    <span
                      className="absolute end-2 top-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-r-transparent"
                      aria-hidden="true"
                    />
                  ) : (
                    current && <Icon name="check" size={14} className="absolute end-2 top-2 text-brand" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="px-4 pb-4 pt-3 sm:px-6 sm:pb-6">
          <button
            type="button"
            onClick={() => choose(locale)}
            aria-disabled={switchingTo ? true : undefined}
            className="pressable w-full rounded-full border border-line bg-paper px-4 py-3 text-sm font-semibold text-ink hover:border-brand/40 hover:text-brand"
          >
            {t('langPrompt.keep')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
