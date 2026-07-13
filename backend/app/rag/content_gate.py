"""Content validation gate for corpus ingestion.

The failure mode this exists to prevent (observed in production of this very
repo): scrapers writing navigation menus and 1-byte table-of-contents page
numbers to disk with success metadata, which then got chunked, embedded, and
served as "real public data". Nothing may enter data/raw/ without passing
this gate. A rejected document is NOT written; the reason is logged and
returned so pipeline scripts can report a per-source scoreboard.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass


@dataclass
class GateResult:
    ok: bool
    reason: str
    fingerprint: str  # md5 of normalized text, for cross-document dedupe


# Signatures of known junk shapes.
_NAV_MENU_HINTS = (
    "investigation process\ninvestigation reports",
    "news & events\nevents\nnewsroom",
)


def validate_document(
    text: str,
    *,
    min_chars: int = 2500,
    required_any: tuple[str, ...] = (),
    seen_fingerprints: set[str] | None = None,
) -> GateResult:
    """Accept a document only if it plausibly contains real narrative text.

    Checks, in order:
      1. length — a risk-factor section or crash narrative is never 19 bytes
      2. nav-menu signature — the scraped-website-chrome failure mode
      3. line-shape — real prose has sentences; menus are short line fragments
      4. domain keywords — at least one of `required_any` must appear
      5. dedupe — byte-identical documents under different ids are rejected
    """
    norm = re.sub(r"\s+", " ", text or "").strip()
    fp = hashlib.md5(norm.lower().encode("utf-8")).hexdigest()

    if len(norm) < min_chars:
        return GateResult(False, f"too short ({len(norm)} chars < {min_chars})", fp)

    lowered = text.lower()
    for hint in _NAV_MENU_HINTS:
        if hint in lowered:
            return GateResult(False, "matches site-navigation signature", fp)

    # Prose check: mean words per line and sentence punctuation density.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        mean_words = sum(len(ln.split()) for ln in lines) / len(lines)
        sentences = norm.count(". ") + norm.count("? ") + norm.count("! ")
        if mean_words < 4 and sentences < 5:
            return GateResult(False, f"menu-shaped text (mean {mean_words:.1f} words/line, {sentences} sentences)", fp)

    if required_any and not any(k.lower() in lowered for k in required_any):
        return GateResult(False, f"missing all domain keywords {list(required_any)}", fp)

    if seen_fingerprints is not None:
        if fp in seen_fingerprints:
            return GateResult(False, "duplicate of an already-ingested document", fp)
        seen_fingerprints.add(fp)

    return GateResult(True, "ok", fp)
