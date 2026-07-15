import type { Metadata } from 'next';
import Prose from '@/components/Prose';

export const metadata: Metadata = { title: 'Grievance / Right to Reply' };

// TEMPORARY: grievance@rankyourpolitician.com is not a provisioned mailbox, so
// grievance mail — which the IT Rules 2021 require us to acknowledge in 24h —
// was silently going nowhere. This personal address is a monitored stopgap
// until a mailbox on the domain exists. Override per-environment with
// NEXT_PUBLIC_GRIEVANCE_EMAIL; switch this default the moment the real one is up.
const EMAIL = process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL || 'shelock221bholmes@gmail.com';

export default async function GrievancePage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const subject = encodeURIComponent(`Correction / Right to reply${ref ? ` — ${ref}` : ''}`);

  return (
    <Prose title="Grievance & Right to Reply" updated="14 July 2026">
      <p>
        We publish only sourced, factual information about public office-holders and we take accuracy seriously.
        This page is our grievance mechanism, aligned with India's Information Technology (Intermediary
        Guidelines) Rules, 2021.
      </p>

      <h2>Request a correction or right to reply</h2>
      <p>
        If you are a representative (or their office), or you have spotted an error, email us with the details
        and any supporting official source:
      </p>
      <p>
        <a href={`mailto:${EMAIL}?subject=${subject}`}>{EMAIL}</a>
        {ref && (
          <>
            {' '}
            — regarding profile <code>{ref}</code>
          </>
        )}
      </p>
      <p>Please include the specific fact, why it is wrong or out of date, and a link to an official source for the correct information.</p>

      <h2>How we handle grievances</h2>
      <ul>
        <li>We acknowledge every grievance within <strong>24 hours</strong>.</li>
        <li>We aim to resolve it within <strong>15 days</strong>.</li>
        <li>Where a fact is corrected, we update it and keep a record of the change.</li>
        <li>A right-to-reply statement can be published alongside the relevant profile.</li>
      </ul>

      <h2>Grievance Officer</h2>
      <p>
        In accordance with the IT Rules, 2021, grievances are handled by our Grievance Officer:
      </p>
      <ul>
        <li><strong>Name:</strong> [add Grievance Officer name]</li>
        <li><strong>Email:</strong> {EMAIL}</li>
        <li><strong>Based in:</strong> India</li>
      </ul>
      <p className="text-sm">
        <em>Note for the site operator: replace the placeholders above with a real, India-based grievance
        officer and monitored contact before going live. This is a legal requirement for intermediary safe
        harbour.</em>
      </p>
    </Prose>
  );
}
