// A schema.org block, rendered into the page HTML where crawlers read it.
//
// application/ld+json is data, not code - the CSP's script-src never evaluates
// it - but the string still sits inside a <script> element, so the one sequence
// that can close that element early is escaped.
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/** Drop undefined/empty entries so a sparse record never emits empty schema
 *  fields (an empty `jobTitle` is worse than no `jobTitle`). */
export function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)),
  );
}
