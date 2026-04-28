"""Download NTSB highway-mode accident-investigation reports.

NTSB publishes report PDFs and HTML summaries at https://ntsb.gov.
For demo purposes we ingest a curated index of public investigation pages
(highway-mode commercial-truck investigations) and persist the narrative
text. Idempotent.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("02_download_ntsb")

OUT_DIR = settings.data_dir / "raw" / "ntsb"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# A small curated seed list. Real script reads from a CSV index (search export
# from NTSB's investigation database). For the demo we include enough to
# exercise the chunker / index.
SEED_INVESTIGATIONS = [
    {
        "id": "ntsb-2019-04",
        "url": "https://www.ntsb.gov/investigations/Pages/HWY19MH004.aspx",
        "title": "I-35 multi-vehicle commercial truck crash · 2019",
    },
    {
        "id": "ntsb-2020-08",
        "url": "https://www.ntsb.gov/investigations/Pages/HWY20MH008.aspx",
        "title": "Commercial doubles-trailer fatigue · 2020",
    },
    {
        "id": "ntsb-2022-12",
        "url": "https://www.ntsb.gov/investigations/Pages/HWY22MH012.aspx",
        "title": "Brake-adjustment failure · jackknife I-10 · 2022",
    },
    {
        "id": "ntsb-2023-03",
        "url": "https://www.ntsb.gov/investigations/Pages/HWY23MH003.aspx",
        "title": "Fog pileup commercial truck · 2023",
    },
    {
        "id": "ntsb-2024-01",
        "url": "https://www.ntsb.gov/investigations/Pages/HWY24MH001.aspx",
        "title": "Hazmat carrier bridge strike · 2024",
    },
]


def _fetch(url: str) -> str | None:
    try:
        r = httpx.get(
            url,
            timeout=15,
            follow_redirects=True,
            headers={"User-Agent": "uw-copilot-demo/0.1 (contact 23juliorod@gmail.com)"},
        )
        if r.status_code != 200:
            return None
        return r.text
    except Exception as e:
        log.warning("fetch %s failed: %s", url, e)
        return None


def _extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for s in soup(["script", "style", "noscript"]):
        s.decompose()
    body = soup.body or soup
    text = body.get_text(separator="\n").strip()
    # Collapse blank lines
    return "\n".join(line.strip() for line in text.splitlines() if line.strip())


def main():
    seed_path = Path(__file__).parent / "ntsb_seed.json"
    if seed_path.exists():
        seeds = json.loads(seed_path.read_text())
    else:
        seeds = SEED_INVESTIGATIONS
        seed_path.write_text(json.dumps(seeds, indent=2))

    fetched = 0
    for s in seeds:
        out = OUT_DIR / f"{s['id']}.txt"
        meta = OUT_DIR / f"{s['id']}.meta.json"
        if out.exists():
            log.info("skipping (cached) %s", s["id"])
            continue
        html = _fetch(s["url"])
        if not html:
            # Fallback: write a synthesized placeholder narrative so the
            # downstream index-build still has something realistic. This
            # keeps the demo deterministic when ntsb.gov is unreachable.
            out.write_text(
                f"NTSB highway-mode investigation summary — {s['title']}.\n\n"
                "On the night of the incident, the operator of a commercial truck combination "
                "experienced a critical event consistent with the investigation's findings. "
                "BASIC scores, hours-of-service logs, and ELD data were reviewed. The carrier's "
                "operating authority status, fleet composition, and prior crash history were "
                "examined for contributing factors. Toxicology, brake adjustment, vehicle "
                "maintenance, and roadway conditions were assessed."
            )
            meta.write_text(json.dumps({**s, "fallback": True}, indent=2))
            continue
        out.write_text(_extract_text(html))
        meta.write_text(json.dumps({**s, "host": urlparse(s["url"]).netloc}, indent=2))
        fetched += 1
        time.sleep(1.0)
    log.info("done · %d new investigations downloaded", fetched)


if __name__ == "__main__":
    main()
