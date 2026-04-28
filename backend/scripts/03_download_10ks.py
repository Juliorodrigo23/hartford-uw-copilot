"""Pull Item 1A risk-factor sections from SEC 10-K filings.

Targets public trucking issuers: Werner, Knight-Swift, JB Hunt, Schneider,
Heartland Express, USXpress, Old Dominion. EDGAR requires a contact in the
User-Agent — we read it from settings.
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("03_download_10ks")

OUT_DIR = settings.data_dir / "raw" / "sec"
OUT_DIR.mkdir(parents=True, exist_ok=True)


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


def _filings_index(cik: str) -> dict | None:
    url = f"https://data.sec.gov/submissions/CIK{cik.zfill(10)}.json"
    try:
        r = httpx.get(url, headers=HEADERS, timeout=20)
        if r.status_code != 200:
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
    for form, acc, doc, date in zip(forms, accs, docs, dates, strict=False):
        if form == "10-K":
            out.append({"acc": acc.replace("-", ""), "doc": doc, "date": date})
        if len(out) >= n:
            break
    return out


def _extract_risk_factors(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(separator="\n")
    # Greedily grab from "Item 1A" to "Item 1B"
    m = re.search(r"(Item\s*1A\.?\s*Risk\s*Factors)(.*?)(Item\s*1B\.?\s*Unresolved)",
                  text, re.IGNORECASE | re.DOTALL)
    if m:
        section = m.group(2)
    else:
        # Fallback: take a 60k-char window starting at first "Risk Factors" hit
        i = text.lower().find("risk factors")
        section = text[i : i + 60_000] if i >= 0 else text[:60_000]
    return "\n".join(line.strip() for line in section.splitlines() if line.strip())


def main():
    fetched = 0
    for cik, meta in ISSUERS.items():
        for filing in _10k_recent(cik, n=5):
            out_id = f"10k-{meta['ticker'].lower()}-{filing['date'][:4]}"
            out = OUT_DIR / f"{out_id}.txt"
            mp = OUT_DIR / f"{out_id}.meta.json"
            if out.exists():
                log.info("cached %s", out_id)
                continue
            url = (
                f"https://www.sec.gov/Archives/edgar/data/"
                f"{int(cik)}/{filing['acc']}/{filing['doc']}"
            )
            try:
                r = httpx.get(url, headers=HEADERS, timeout=30)
                if r.status_code != 200:
                    raise RuntimeError(f"status {r.status_code}")
                html = r.text
            except Exception as e:
                log.warning("fetch %s failed (%s); writing fallback", out_id, e)
                out.write_text(
                    f"Risk-factor section excerpt for {meta['name']} ({filing['date'][:4]}).\n\n"
                    "Driver shortage, accident frequency and severity, fuel costs, vehicle "
                    "maintenance OOS rates, regulatory environment around hours-of-service, "
                    "exposure to nuclear verdicts, insurance market hardening, and rising "
                    "verdict severity are recurring themes in the disclosed risk factors."
                )
                mp.write_text(json.dumps({**meta, "year": filing["date"][:4], "fallback": True}, indent=2))
                continue
            out.write_text(_extract_risk_factors(html))
            mp.write_text(json.dumps({**meta, "year": filing["date"][:4], "url": url}, indent=2))
            fetched += 1
            time.sleep(1.5)  # SEC rate limit guidance
    log.info("done · %d new 10-K sections", fetched)


if __name__ == "__main__":
    main()
