'use client';
import { useState } from 'react';
import Icon from './Icon';

export default function ShareButton({
  title,
  text,
  url,
  label,
  successLabel,
}: {
  title: string;
  text: string;
  url: string;
  label: string;
  successLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${url}` : url;
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url: shareUrl,
        });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Web Share failed:', err);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Clipboard copy failed:', err);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className="pressable inline-flex items-center gap-1.5 rounded-full border border-line bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-brand/40 hover:text-brand"
    >
      <Icon name={copied ? 'check' : 'share'} size={14} className={copied ? 'text-good dark:text-green-400' : ''} />
      <span>{copied ? successLabel : label}</span>
    </button>
  );
}
