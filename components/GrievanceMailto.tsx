'use client';
// Reads the ?ref= profile id in the browser so the grievance page itself can
// be fully static - reading searchParams on the server would force the whole
// route to render per request.
import { useEffect, useState } from 'react';

export default function GrievanceMailto({ email }: { email: string }) {
  // ?ref= comes from window.location, not useSearchParams(): it is only read
  // ONCE on mount, and useSearchParams forced a Suspense boundary whose
  // streamed reveal can wedge on the fallback in dev (see RankingsExplorer.tsx
  // / Finder.tsx). Until the effect runs this renders the same link with the
  // un-suffixed subject, so nothing jumps visually.
  const [ref, setRef] = useState<string | undefined>(undefined);
  useEffect(() => {
    setRef(new URLSearchParams(window.location.search).get('ref') ?? undefined);
  }, []);

  const subject = encodeURIComponent(`Correction / Right to reply${ref ? ` - ${ref}` : ''}`);
  return (
    <>
      <a href={`mailto:${email}?subject=${subject}`}>{email}</a>
      {ref && (
        <>
          {' '}
          - regarding profile <code>{ref}</code>
        </>
      )}
    </>
  );
}
