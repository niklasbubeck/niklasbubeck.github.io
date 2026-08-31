#!/usr/bin/env python3
"""Bake Semantic Scholar publications into index.html as static markup + JSON-LD.

Googlebot indexes raw HTML immediately and defers JS rendering, so anything the
carousel fetches client-side is effectively invisible to search. This writes the
publication list into the HTML at build time; scholar-integration.js still wipes
the viewport and renders the interactive carousel on top for real visitors.

Safe by design: on any fetch/parse failure it exits non-zero WITHOUT writing,
so a rate-limited API can never blank out good content already in the file.
"""
import html
import json
import re
import ssl
import sys
import urllib.request
from pathlib import Path

AUTHOR_ID = "2372230806"
PERSON_ID = "https://niklasbubeck.com/#niklas-bubeck"
SITE = "https://niklasbubeck.com/"
ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"

FIELDS = ",".join([
    "name", "paperCount", "citationCount", "hIndex",
    "papers.title", "papers.authors", "papers.venue", "papers.year",
    "papers.citationCount", "papers.url", "papers.externalIds", "papers.paperId",
])
API = f"https://api.semanticscholar.org/graph/v1/author/{AUTHOR_ID}?fields={FIELDS}"

MAX_VISIBLE_AUTHORS = 6


def fetch():
    req = urllib.request.Request(API, headers={"User-Agent": "niklasbubeck.com build script"})
    with urllib.request.urlopen(req, timeout=45, context=ssl.create_default_context()) as r:
        return json.loads(r.read().decode())


def norm(title):
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


def best_link(p):
    ext = p.get("externalIds") or {}
    # A real journal/conference DOI is the canonical home; 10.48550 is just
    # arXiv's own DOI, so prefer the arXiv abs page over that.
    doi = ext.get("DOI") or ""
    if doi and not doi.startswith("10.48550/"):
        return f"https://doi.org/{doi}"
    if ext.get("ArXiv"):
        return f"https://arxiv.org/abs/{ext['ArXiv']}"
    if doi.startswith("10.48550/arXiv."):
        return f"https://arxiv.org/abs/{doi.split('10.48550/arXiv.', 1)[1]}"
    if doi:
        return f"https://doi.org/{doi}"
    return p.get("url") or f"https://www.semanticscholar.org/paper/{p.get('paperId','')}"


def dedupe(papers):
    """Semantic Scholar lists preprint + published versions of the same work
    separately. Collapse by normalised title, preferring a real venue and
    keeping the highest citation count seen for the work."""
    merged = {}
    for p in papers:
        if not p.get("title"):
            continue
        k = norm(p["title"])
        cur = merged.get(k)
        if cur is None:
            merged[k] = p
            continue
        cites = max(cur.get("citationCount") or 0, p.get("citationCount") or 0)
        real = lambda q: (q.get("venue") or "").strip() not in ("", "arXiv.org")
        win = p if (real(p) and not real(cur)) else cur
        loser = cur if win is p else p
        # keep an arXiv id from whichever version has one
        ids = dict(loser.get("externalIds") or {})
        ids.update({k2: v for k2, v in (win.get("externalIds") or {}).items() if v})
        win = dict(win, citationCount=cites, externalIds=ids)
        merged[k] = win
    out = list(merged.values())
    out.sort(key=lambda p: ((p.get("year") or 0), (p.get("citationCount") or 0)), reverse=True)
    return out


def render_html(papers):
    rows = []
    for p in papers:
        names = [a.get("name", "") for a in (p.get("authors") or []) if a.get("name")]
        shown = names[:MAX_VISIBLE_AUTHORS]
        authors = ", ".join(shown) + (" et al." if len(names) > len(shown) else "")
        venue = (p.get("venue") or "").strip()
        venue = "arXiv preprint" if venue in ("", "arXiv.org") else venue
        year = p.get("year") or ""
        cites = p.get("citationCount") or 0
        cite_txt = f" · {cites} citation{'s' if cites != 1 else ''}" if cites else ""
        rows.append(
            '                                    <li class="publication-static-item">\n'
            f'                                        <a class="publication-static-title" href="{html.escape(best_link(p))}" target="_blank" rel="noopener">{html.escape(p["title"])}</a>\n'
            f'                                        <span class="publication-static-authors">{html.escape(authors)}</span>\n'
            f'                                        <span class="publication-static-meta">{html.escape(venue)} · {year}{cite_txt}</span>\n'
            "                                    </li>"
        )
    return (
        '                            <ul class="publications-static">\n'
        + "\n".join(rows)
        + "\n                            </ul>"
    )


def render_stats(papers, prof):
    """Four tiles, in the order scholar-integration.js indexes them
    (statLabels[0..3]). Keeping exactly four keeps that indexing valid."""
    cites = prof.get("citationCount") or sum((p.get("citationCount") or 0) for p in papers)
    i10 = sum(1 for p in papers if (p.get("citationCount") or 0) >= 10)
    tiles = [
        (cites, "Total Citations"),
        (prof.get("hIndex") or 0, "h-index"),
        (i10, "i10-index"),
        (len(papers), "Papers"),
    ]
    return "\n".join(
        '                    <div class="stat-item">\n'
        f'                        <div class="stat-number">{n}</div>\n'
        f'                        <div class="stat-label">{html.escape(label)}</div>\n'
        "                    </div>"
        for n, label in tiles
    )


def render_jsonld(papers, prof):
    items = []
    for i, p in enumerate(papers, 1):
        art = {
            "@type": "ScholarlyArticle",
            "position": i,
            "name": p["title"],
            "url": best_link(p),
            "author": [{"@type": "Person", "name": a["name"]}
                       for a in (p.get("authors") or []) if a.get("name")],
        }
        if p.get("year"):
            art["datePublished"] = str(p["year"])
        venue = (p.get("venue") or "").strip()
        if venue and venue != "arXiv.org":
            art["publication"] = venue
        ext = p.get("externalIds") or {}
        if ext.get("DOI"):
            art["sameAs"] = f"https://doi.org/{ext['DOI']}"
        items.append(art)
    doc = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"Publications by {prof.get('name', 'Niklas Bubeck')}",
        "itemListOrder": "https://schema.org/ItemListOrderDescending",
        "numberOfItems": len(items),
        "mainEntityOfPage": SITE,
        "about": {"@id": PERSON_ID},
        "itemListElement": items,
    }
    body = json.dumps(doc, indent=8, ensure_ascii=False)
    return ('    <script type="application/ld+json">\n'
            + "\n".join("    " + ln for ln in body.splitlines())
            + "\n    </script>")


def splice(src, start, end, payload):
    pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pat.search(src):
        raise SystemExit(f"marker pair not found: {start}")
    return pat.sub(lambda _: f"{start}\n{payload}\n{end}", src, count=1)


def main():
    try:
        prof = fetch()
        papers = dedupe(prof.get("papers") or [])
    except Exception as e:                      # noqa: BLE001
        print(f"fetch/parse failed ({type(e).__name__}: {e}) — index.html left untouched",
              file=sys.stderr)
        return 1
    if not papers:
        print("API returned zero papers — index.html left untouched", file=sys.stderr)
        return 1

    src = original = INDEX.read_text(encoding="utf-8")
    src = splice(src,
                 "<!-- PUBLICATIONS:START (generated by scripts/build_publications.py — do not edit by hand) -->",
                 "<!-- PUBLICATIONS:END -->", render_html(papers))
    src = splice(src, "<!-- PUBLICATIONS-JSONLD:START -->",
                 "<!-- PUBLICATIONS-JSONLD:END -->", render_jsonld(papers, prof))
    src = splice(src, "<!-- STATS:START (generated by scripts/build_publications.py) -->",
                 "<!-- STATS:END -->", render_stats(papers, prof))

    if src == original:
        print(f"no change ({len(papers)} publications)")
        return 0
    INDEX.write_text(src, encoding="utf-8")
    print(f"wrote {len(papers)} publications into index.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
