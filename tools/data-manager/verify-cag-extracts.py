"""
Data-manager step: check every candidate CAG finding against the real report PDF,
and write data/seed/cag_report_extracts.json with ONLY the ones that check out.

WHY THIS EXISTS
The compiled index we seed the report list from also carries quoted findings with
a page reference. A hand sample of 33 of those quotes across 12 governments found
29 present in the cited PDF and 4 absent. That is a good hit rate for a research
aid and a completely unacceptable one for a site whose rule is "no citation, no
claim" - publishing a sentence in the Comptroller's name that the Comptroller
never wrote, about a named government, is exactly the confident-wrong-answer
failure this repo guards against.

So nothing is taken on trust. Each candidate quote is looked for in the text of
the page it cites (with a small window either side, because page numbering in
these reports drifts from the PDF's own page index). Only a quote actually found
in the document is published, and it is published with its page number and a
link to the PDF, so any reader can check it in two clicks.

This is Python rather than tsx because the PDF text extraction is; everything
else about the CAG import is in TypeScript beside it.

RESUMABLE. Verification results are cached per (url, page, quote) in
tools/data-manager/.cache/, so a re-run only fetches what it has not seen. PDFs
are streamed to a temp file, read, and deleted - the corpus is ~10 GB and is
never kept.

Usage:
  python tools/data-manager/verify-cag-extracts.py [--apply] [--limit=N] [--max-mb=N]
    --apply     write data/seed/cag_report_extracts.json (otherwise report only)
    --limit     stop after N PDFs this run (the cache makes runs additive)
    --max-mb    skip PDFs bigger than this (default 80)
    --from-cache  fetch nothing; just rewrite the seed from verdicts already cached
"""
import json
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DIR = os.path.join(ROOT, "tools", "data-manager", ".cache")
CANDIDATES = os.path.join(CACHE_DIR, "cag-extract-candidates.json")
RESULT_CACHE = os.path.join(CACHE_DIR, "cag-extract-verdicts.json")
OUT = os.path.join(ROOT, "data", "seed", "cag_report_extracts.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-IN,en;q=0.9",
}

args = sys.argv[1:]
APPLY = "--apply" in args
LIMIT = next((int(a.split("=")[1]) for a in args if a.startswith("--limit=")), None)
FROM_CACHE = "--from-cache" in args
MAX_MB = next((int(a.split("=")[1]) for a in args if a.startswith("--max-mb=")), 80)
# How far either side of the cited page to look. These reports print their own
# page numbers, which sit some way off the PDF's page index because of front
# matter (contents, preface, glossary - often roman-numeraled and 10-20 pages).
# The window absorbs that drift.
#
# There is deliberately NO "search the whole document" fallback. If a sentence
# is not anywhere near the page cited for it, then even when the sentence is
# real the page reference is wrong - and a page reference a reader cannot use is
# not a citation. Rejecting is also what keeps this affordable: the fallback
# meant parsing every page of a 45 MB PDF for exactly the quotes least likely to
# be publishable.
WINDOW = 25


def norm(s: str) -> str:
    """Compare on letters and digits only: the PDFs use ` and Rs. and the rupee
    sign interchangeably, hyphenate across line breaks, and carry footnote
    markers glued to words."""
    s = re.sub(r"[‘’]", "'", s)
    s = re.sub(r"[“”]", '"', s)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def fragments(quote: str):
    """A quote often elides with '...'. Every fragment must be present."""
    parts = [norm(p) for p in re.split(r"\.\.\.|…", quote)]
    parts = [p for p in parts if len(p) >= 25]
    return parts or [norm(quote)]


def encode_url(url: str) -> str:
    """Percent-encode what the Comptroller left raw.

    Sixty-odd report URLs on cag.gov.in carry literal spaces ("DDUGJY ENGLISHI
    ALL PAGES-...pdf"). Node's fetch encodes those on the way out, so the
    import-time link check passed them and they sit in the seed as-is; urllib
    refuses them outright with InvalidURL. '%' is in the safe set so anything
    already escaped is left alone rather than escaped twice.
    """
    return urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=~-._%")


def download(url: str, max_bytes: int):
    """Stream to a temp file. Returns path, or None if too big / unavailable."""
    req = urllib.request.Request(encode_url(url), headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            size = int(r.headers.get("Content-Length") or 0)
            if size and size > max_bytes:
                return None, f"skipped ({size // 1048576} MB)"
            fd, path = tempfile.mkstemp(suffix=".pdf")
            written = 0
            with os.fdopen(fd, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > max_bytes:
                        f.close()
                        os.unlink(path)
                        return None, "skipped (over limit while streaming)"
                    f.write(chunk)
            return path, None
    except Exception as e:  # noqa: BLE001 - any failure means "cannot verify"
        return None, f"fetch failed: {type(e).__name__}"


def verify_pdf(url, items, max_bytes):
    """Return {cache_key: bool} for every candidate quote on this PDF."""
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    out = {}
    path, why = download(url, max_bytes)
    if path is None:
        return out, why
    try:
        reader = PdfReader(path, strict=False)
        n = len(reader.pages)
        cache_text = {}

        def page_text(i):
            if i not in cache_text:
                try:
                    cache_text[i] = norm(reader.pages[i].extract_text() or "")
                except Exception:  # noqa: BLE001
                    cache_text[i] = ""
            return cache_text[i]

        for it in items:
            frags = fragments(it["quote"])
            cited = it["page"] - 1
            lo, hi = max(0, cited - WINDOW), min(n, cited + WINDOW + 1)
            out[it["_key"]] = all(any(f in page_text(i) for i in range(lo, hi)) for f in frags)
        return out, None
    except (PdfReadError, Exception) as e:  # noqa: BLE001
        return out, f"parse failed: {type(e).__name__}"
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def main():
    if not os.path.exists(CANDIDATES):
        sys.exit(f"missing {CANDIDATES}\n  run: npx tsx tools/data-manager/import-cag-reports.ts --apply")

    with open(CANDIDATES, encoding="utf-8") as f:
        cands = json.load(f)
    for c in cands:
        c["_key"] = f"{c['source_url']}|{c['page']}|{norm(c['quote'])[:80]}"

    verdicts = {}
    if os.path.exists(RESULT_CACHE):
        with open(RESULT_CACHE, encoding="utf-8") as f:
            verdicts = json.load(f)

    by_url = {}
    for c in cands:
        by_url.setdefault(c["source_url"], []).append(c)

    todo = [(u, items) for u, items in by_url.items()
            if any(i["_key"] not in verdicts for i in items)]
    # --from-cache publishes what has already been checked and fetches nothing.
    # The corpus is ~10 GB and the big reports are slow, so verification is
    # expected to run over several sessions; this makes each session shippable.
    if FROM_CACHE:
        todo = []
    elif LIMIT:
        todo = todo[:LIMIT]

    print(f"candidates: {len(cands)} across {len(by_url)} reports")
    print(f"  already verified: {len(by_url) - len([1 for u, i in by_url.items() if any(x['_key'] not in verdicts for x in i)])} reports")
    print(f"  this run: {len(todo)} reports (max {MAX_MB} MB each)")

    max_bytes = MAX_MB * 1048576
    done = 0
    skipped = []
    # as_completed, NOT submission order: these PDFs range from 1 MB to 190 MB,
    # and collecting in order meant one 80 MB download stalled all reporting and
    # all cache flushes behind it while seven workers sat idle.
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(verify_pdf, u, items, max_bytes): u for u, items in todo}
        for fut in as_completed(futures):
            url = futures[fut]
            res, why = fut.result()
            verdicts.update(res)
            if why:
                skipped.append((url, why))
            done += 1
            if done % 10 == 0 or done == len(todo):
                sys.stdout.write(f"\r    {done}/{len(todo)} reports")
                sys.stdout.flush()
                os.makedirs(CACHE_DIR, exist_ok=True)
                with open(RESULT_CACHE, "w", encoding="utf-8") as f:
                    json.dump(verdicts, f)
    if todo:
        print()

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(RESULT_CACHE, "w", encoding="utf-8") as f:
        json.dump(verdicts, f)

    checked = [c for c in cands if c["_key"] in verdicts]
    good = [c for c in checked if verdicts[c["_key"]]]
    print(f"\n  quotes checked: {len(checked)}/{len(cands)}")
    if checked:
        print(f"  verified in the PDF: {len(good)} ({100 * len(good) // max(1, len(checked))}%)")
    if skipped:
        print(f"  reports not readable this run: {len(skipped)}")
        for u, why in skipped[:5]:
            print(f"    {why}: ...{u[-60:]}")

    out = {}
    for c in good:
        out.setdefault(c["source_url"], []).append(
            {k: c[k] for k in ("page", "section", "quote") if c.get(k) is not None}
        )
    for v in out.values():
        v.sort(key=lambda x: x["page"])

    govs = {c["gov"] for c in good}
    print(f"  reports with at least one verified extract: {len(out)}")
    print(f"  governments represented: {len(govs)}")

    if not APPLY:
        print("\n  Report only. Re-run with --apply to write data/seed/cag_report_extracts.json")
        return

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    size = os.path.getsize(OUT) / 1024
    print(f"\n[ok] Wrote extracts for {len(out)} reports to data/seed/cag_report_extracts.json ({size:.0f} KB)")


if __name__ == "__main__":
    main()
