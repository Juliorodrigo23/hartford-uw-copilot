"""Pull Item 1A risk-factor sections from SEC 10-K filings.

Post-mortem baked into this script: the previous extractor took the FIRST
"Item 1A ... Item 1B" regex match, which in a 10-K is the TABLE OF CONTENTS
row — so it wrote the page number ("17") to disk as the "risk factor
section" and recorded success. Fixes:

  - `_extract_risk_factors` collects ALL Item 1A→1B spans and keeps the
    LONGEST (the body section dwarfs the TOC row).
  - Every candidate passes the content gate (min length, prose shape,
    insurance/risk keywords) before anything is written. No placeholders.
  - Legacy junk on disk that fails the gate is purged on run.

Targets public trucking issuers. EDGAR requires a contact User-Agent.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402
from app.rag.content_gate import validate_document  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("03_download_10ks")

OUT_DIR = settings.data_dir / "raw" / "sec"
OUT_DIR.mkdir(parents=True, exist_ok=True)

GATE_KWARGS = dict(
    min_chars=4000,
    required_any=("risk", "insurance", "claims", "accident", "liability"),
)

# CIK numbers for the target issuers. CIK -> {ticker, name}.
ISSUERS = {
    "0000793074": {"ticker": "WERN", "name": "Werner Enterprises"},
    "0001492691": {"ticker": "KNX", "name": "Knight-Swift"},
    "0000728535": {"ticker": "JBHT", "name": "JB Hunt Transport"},
    "0001692063": {"ticker": "SNDR", "name": "Schneider National"},
    "0000799233": {"ticker": "HTLD", "name": "Heartland Express"},
    "0000923571": {"ticker": "USX",  "name": "US Xpress"},
    "0000878927": {"ticker": "ODFL", "name": "Old Dominion Freight Line"},
}

HEADERS = {
    "User-Agent": settings.sec_edgar_user_agent,
    "Accept-Encoding": "gzip, deflate",
}

_ITEM_RE = re.compile(
    r"Item\s*1A[\.\:\s ]*Risk\s*Factors(.*?)Item\s*1B",
    re.IGNORECASE | re.DOTALL,
)


def _filings_index(cik: str) -> dict | None:
    url = f"https://data.sec.gov/submissions/CIK{cik.zfill(10)}.json"
    try:
        r = httpx.get(url, headers=HEADERS, timeout=20)
        if r.status_code != 200:
            log.warning("filings index HTTP %s for CIK %s", r.status_code, cik)
            return None
        return r.json()
    except Exception as e:
        log.warning("filings index failed for CIK %s: %s", cik, e)
        return None


def _10k_recent(cik: str, n: int = 5) -> list[dict]:
    idx = _filings_index(cik)
    if not idx:
        return []
    recent = idx.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accs = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])
    dates = recent.get("filingDate", [])
    out = []
    for form, acc, doc, date in zip(forms, accs, docs, dates):
        if form == "10-K":
            out.append({"acc": acc.replace("-", ""), "doc": doc, "date": date})
        if len(out) >= n:
            break
    return out


def _extract_risk_factors(html: str) -> str:
    """Longest Item 1A→1B span in the document (the TOC row is characters
    long; the actual section is tens of thousands)."""
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(separator="\n")
    candidates = [m.group(1) for m in _ITEM_RE.finditer(text)]
    section = max(candidates, key=len) if candidates else ""
    if len(section) < 4000:
        # Fallback: window after the LAST "risk factors" heading mention
        # (the last mention is in the body; the first is usually the TOC).
        i = text.lower().rfind("risk factors")
        if i >= 0:
            section = text[i : i + 80_000]
    return "\n".join(line.strip() for line in section.splitlines() if line.strip())


def main() -> int:
    # Purge legacy junk (the 1-byte TOC page numbers from the old extractor).
    seen: set[str] = set()
    for txt in sorted(OUT_DIR.glob("*.txt")):
        gate = validate_document(txt.read_text(errors="ignore"), seen_fingerprints=seen, **GATE_KWARGS)
        if not gate.ok:
            log.warning("purging legacy junk %s (%s)", txt.name, gate.reason)
            txt.unlink(missing_ok=True)
            txt.with_suffix(".meta.json").unlink(missing_ok=True)

    saved = 0
    for cik, meta in ISSUERS.items():
        for filing in _10k_recent(cik, n=5):
            out_id = f"10k-{meta['ticker'].lower()}-{filing['date'][:4]}"
            out = OUT_DIR / f"{out_id}.txt"
            if out.exists():
                saved += 1
                continue
            url = (
                f"https://www.sec.gov/Archives/edgar/data/"
                f"{int(cik)}/{filing['acc']}/{filing['doc']}"
            )
            try:
                r = httpx.get(url, headers=HEADERS, timeout=60)
                if r.status_code != 200:
                    log.warning("skip %s: HTTP %s", out_id, r.status_code)
                    continue
                section = _extract_risk_factors(r.text)
            except Exception as e:
                log.warning("skip %s: %s", out_id, e)
                continue
            gate = validate_document(section, seen_fingerprints=seen, **GATE_KWARGS)
            if not gate.ok:
                log.warning("REJECTED %s: %s (fetched %d chars of HTML)", out_id, gate.reason, len(r.text))
                continue
            out.write_text(section)
            (OUT_DIR / f"{out_id}.meta.json").write_text(
                json.dumps({**meta, "year": filing["date"][:4], "url": url,
                            "chars": len(section), "gate": "passed"}, indent=2)
            )
            log.info("saved %s (%d chars)", out_id, len(section))
            saved += 1
            time.sleep(1.5)  # SEC rate-limit guidance

    log.info("done · %d validated 10-K sections on disk", saved)
    if saved == 0:
        log.error("ZERO valid 10-K sections ingested — refusing to pretend otherwise.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
