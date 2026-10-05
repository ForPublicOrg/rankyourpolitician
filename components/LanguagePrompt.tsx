'use client';
// First-visit language prompt, mounted once in app/[lang]/layout.tsx.
//
// Locale lives in the URL ([lang], rewritten by middleware.ts from the `lang`
// cookie) so that every page stays static - which means the server can never
// tell a first visit from a returning one. That check runs here, after
// hydration: no remembered choice = ask once. The dialog is its own lazily
// loaded chunk, so returning visitors never download it, and a chunk that
// fails to load on a bad network just means no prompt, never a broken page.
import { useEffect, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/provider';
import { rememberLocale, rememberedLocale } from './LanguageSwitcher';

type DialogProps = { onDone: () => void };

// Crawlers and automation get the page alone: a popup in a rendered snapshot
// reads to search engines as an intrusive interstitial.
const AUTOMATED = /bot|crawl|spider|slurp|google-|mediapartners|lighthouse|headless|preview|facebookexternalhit/i;

export default function LanguagePrompt() {
  const { locale } = useI18n();
  const router = useRouter();
  const [Dialog, setDialog] = useState<ComponentType<DialogProps> | null>(null);

  useEffect(() => {
    const { cookie, stored } = rememberedLocale();
    if (cookie) {
      // Re-stamp on every visit, so Safari's 7-day cap on script-set cookies
      // never silently drops an active reader back to English.
      rememberLocale(cookie);
      return;
    }
    if (stored) {
      // The cookie lapsed but the choice survived in storage: honour it
      // rather than ask again.
      rememberLocale(stored);
      if (stored !== locale) router.refresh();
      return;
    }
    // Cookies blocked: a choice could not stick, so asking would just repeat
    // on every page. The header switcher still works for this page.
    if (!navigator.cookieEnabled || navigator.webdriver || AUTOMATED.test(navigator.userAgent)) return;
    // The dialog relies on native <dialog> (focus trap, inert page, Esc).
    if (typeof HTMLDialogElement !== 'function' || !('showModal' in HTMLDialogElement.prototype)) return;
    let live = true;
    import('./LanguagePromptDialog')
      .then((m) => live && setDialog(() => m.default))
      .catch(() => {});
    return () => {
      live = false;
    };
    // Once per page load: the layout persists across client navigations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return Dialog ? <Dialog onDone={() => setDialog(null)} /> : null;
}
