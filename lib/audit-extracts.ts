/**
 * Verified extracts from CAG reports, keyed by the report's PDF URL.
 *
 * WHAT AN EXTRACT IS: a sentence the Comptroller wrote, with the page it is on.
 * Nothing else. Not a summary, not a paraphrase, not a severity, not a score.
 * Each one was located in the actual PDF by
 * tools/data-manager/verify-cag-extracts.py before it was allowed into the seed
 * - the compiled index these came from was measured at roughly 90% accurate on
 * quotes, and "roughly" is not a standard for publishing words in the
 * Comptroller's name.
 *
 * DELIBERATELY SEPARATE from lib/audits.ts and never imported by the person
 * page. Extracts are the bulk of this dataset; keeping them in their own module
 * means only /audits/[gov] pays for them, and /person keeps carrying just the
 * report list.
 */
import seed from '@/data/seed/cag_report_extracts.json';

export interface AuditExtract {
  /** Page of the PDF the sentence was found on, as the report prints it. */
  page: number;
  /** Chapter/paragraph reference where the source gave one. */
  section?: string;
  /** The Comptroller's own sentence, verbatim. */
  quote: string;
}

const byUrl = seed as Record<string, AuditExtract[]>;

/** Verified extracts for one report, in page order. Empty when none survived
 *  verification - the page then shows the report without them rather than
 *  filling the gap with somebody's summary. */
export function extractsFor(sourceUrl: string): AuditExtract[] {
  return byUrl[sourceUrl] ?? [];
}

export const extractedReportCount = (): number => Object.keys(byUrl).length;
