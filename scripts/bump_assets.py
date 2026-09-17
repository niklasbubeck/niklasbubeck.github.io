#!/usr/bin/env python3
"""Bump the ?v= stamp on journey.css / journey.js in index.html.

GitHub Pages serves every file with Cache-Control: max-age=600 and the asset
tags carry no fingerprint, so a returning browser keeps the old CSS and JS for
ten minutes after a deploy — which looks exactly like the deploy not happening.
Bumping the stamp makes each release a new URL, so the moment a browser has the
new index.html it is guaranteed to fetch the new assets with it.

Run before committing a change to journey.css or journey.js.
"""
import re
import sys
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "index.html"


def main():
    src = INDEX.read_text(encoding="utf-8")
    stamps = [int(m) for m in re.findall(r'journey\.(?:css|js)\?v=(\d+)', src)]
    if not stamps:
        print("no ?v= stamps found on the journey assets", file=sys.stderr)
        return 1
    nxt = max(stamps) + 1
    out = re.sub(r'(journey\.(?:css|js))\?v=\d+', rf'\1?v={nxt}', src)
    if out == src:
        print("nothing to bump")
        return 0
    INDEX.write_text(out, encoding="utf-8")
    print(f"journey assets stamped v={nxt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
