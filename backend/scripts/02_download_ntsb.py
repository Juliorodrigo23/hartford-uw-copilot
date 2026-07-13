"""Download NTSB highway accident-investigation narratives.

Post-mortem baked into this script: the previous version fetched
ntsb.gov/investigations/Pages/*.aspx, which are JavaScript-rendered — the
scraper saved the site's NAVIGATION MENU as five "narratives" and recorded
success. Nothing here writes to the corpus without passing the content gate.

Two real-text strategies, in order:

1. **CAROL API** (data.ntsb.gov/carol-main-public) — NTSB's public
   investigation database. We query completed Highway-mode cases and extract
   the probable-cause / analysis narrative fields from the JSON.
2. **Report PDFs** — NTSB publishes Highway Accident Reports as PDFs with
   stable URLs (e.g. .../investigations/AccidentReports/Reports/HAR2201.pdf).
   Seed list in `ntsb_reports.json` (editable); text extracted with pypdf.

Every candidate document runs through app.rag.content_gate.validate_document
(min length, nav-menu signature, prose shape, crash-domain keywords, dedupe).
Rejected documents are NOT written. There are no placeholder narratives —
if everything fails, the script exits loudly with a nonzero status.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.rag.content_gate import validate_document

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("02_download_ntsb")

OUT_DIR = settings.data_dir / "raw" / "ntsb"
OUT_DIR.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "uw-copilot-demo/0.2 (research, contact 23juliorod@gmail.com)"}
GATE_KWARGS = dict(
    min_chars=2500,
    required_any=("crash", "vehicle", "driver", "highway", "carrier", "truck"),
)

CAROL_URL = "https://data.ntsb.gov/carol-main-public/api/Query/Main"

# Highway Accident Report PDFs. Report numbers are printed on every NTSB
# highway report ("NTSB/HAR-XX/YY"); URL pattern is stable. Edit/extend this
# list from https://www.ntsb.gov/investigations/AccidentReports/Pages/highway.aspx
DEFAULT_REPORT_PDFS = [
    {"id": "ntsb-har-2201", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2201.pdf"},
    {"id": "ntsb-har-2202", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2202.pdf"},
    {"id": "ntsb-har-2301", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2301.pdf"},
    {"id": "ntsb-har-2302", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2302.pdf"},
    {"id": "ntsb-har-2401", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2401.pdf"},
    {"id": "ntsb-har-2101", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2101.pdf"},
    {"id": "ntsb-har-2102", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2102.pdf"},
    {"id": "ntsb-har-2001", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR2001.pdf"},
    {"id": "ntsb-har-1901", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR1901.pdf"},
    {"id": "ntsb-har-1902", "url": "https://www.ntsb.gov/investigations/AccidentReports/Reports/HAR1902.pdf"},
]


def _write(doc_id: str, text: str, meta: dict, seen: set[str]) -> bool:
    gate = validate_document(text, seen_fingerprints=seen, **GATE_KWARGS)
    if not gate.ok:
        log.warning("REJECTED %s: %s", doc_id, gate.reason)
        return False
    (OUT_DIR / f"{doc_id}.txt").write_text(text)
    (OUT_DIR / f"{doc_id}.meta.json").write_text(
        json.dumps({**meta, "chars": len(text), "gate": "passed"}, indent=2)
    )
    log.info("saved %s (%d chars)", doc_id, len(text))
    return True


# ---------------------------------------------------------------------------
# Strategy 1: CAROL API
# ---------------------------------------------------------------------------

def _carol_query(max_cases: int = 40) -> list[dict]:
    """Completed Highway investigations with narrative fields."""
    payload = {
        "ResultSetSize": max_cases,
        "ResultSetOffset": 0,
        "QueryGroups": [
            {
                "QueryRules": [
                    {
                        "RuleType": "Simple",
                        "Values": ["Highway"],
                        "Columns": ["Event.Mode"],
                        "Operator": "is",
                    }
                ],
                "AndOr": "and",
            }
        ],
        "AndOr": "and",
        "SortColumn": "EventDate",
        "SortDescending": True,
        "TargetCollection": "cases",
        "SessionId": 0,
    }
    r = httpx.post(CAROL_URL, json=payload, headers=UA, timeout=45)
    r.raise_for_status()
    data = r.json()
    return data.get("Results") or data.get("results") or []


def _narrative_from_case(case: dict) -> tuple[str, str] | None:
    """Pull (case_id, narrative text) from a CAROL case record, defensively."""
    fields: dict[str, str] = {}

    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, str) and len(v) > 200:
                    fields[k] = v
                else:
                    walk(v)
        elif isinstance(obj, list):
            for it in obj:
                walk(it)

    walk(case)
    narrative_keys = [k for k in fields if any(t in k.lower() for t in ("narrative", "analysis", "probablecause", "factual", "summary"))]
    if not narrative_keys:
        return None
    text = "\n\n".join(fields[k] for k in sorted(narrative_keys))
    case_id = str(
        case.get("CM_ntsbNum")
        or case.get("NtsbNo")
        or case.get("Mkey")
        or case.get("cm_mkey")
        # Python's built-in hash is salted per process, which made fallback
        # ids drift across identical ingestion runs.
        or hashlib.sha256(text.encode()).hexdigest()[:12]
    ).replace("/", "-")
    return f"ntsb-carol-{case_id}".lower(), text


def ingest_carol(seen: set[str]) -> int:
    try:
        cases = _carol_query()
    except Exception as e:
        log.warning("CAROL API unavailable (%s) — falling back to report PDFs", e)
        return 0
    saved = 0
    for case in cases:
        got = _narrative_from_case(case)
        if not got:
            continue
        doc_id, text = got
        if (OUT_DIR / f"{doc_id}.txt").exists():
            continue
        if _write(doc_id, text, {"source": "carol", "id": doc_id}, seen):
            saved += 1
    return saved


# ---------------------------------------------------------------------------
# Strategy 2: report PDFs
# ---------------------------------------------------------------------------

def _pdf_text(content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    pages = [p.extract_text() or "" for p in reader.pages]
    return "\n".join(pages)


def ingest_report_pdfs(seen: set[str]) -> int:
    seed_path = Path(__file__).parent / "ntsb_reports.json"
    if seed_path.exists():
        seeds = json.loads(seed_path.read_text())
    else:
        seeds = DEFAULT_REPORT_PDFS
        seed_path.write_text(json.dumps(seeds, indent=2))
    saved = 0
    for s in seeds:
        out = OUT_DIR / f"{s['id']}.txt"
        if out.exists():
            continue
        try:
            r = httpx.get(s["url"], headers=UA, timeout=60, follow_redirects=True)
            if r.status_code != 200 or "pdf" not in (r.headers.get("content-type") or "").lower():
                log.warning("skip %s: HTTP %s / %s", s["id"], r.status_code, r.headers.get("content-type"))
                continue
            text = _pdf_text(r.content)
        except Exception as e:
            log.warning("skip %s: %s", s["id"], e)
            continue
        if _write(s["id"], text, {"source": "report-pdf", **s}, seen):
            saved += 1
        time.sleep(1.0)
    return saved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--existing-only",
        "--offline",
        action="store_true",
        dest="existing_only",
        help=(
            "Validate the local NTSB corpus without making network requests; "
            "succeed when at least one content-gated document exists."
        ),
    )
    args = parser.parse_args()

    # Purge legacy junk: any existing doc that fails the gate is removed so
    # a rebuilt index can't inherit the old navigation menus.
    seen: set[str] = set()
    existing = 0
    for txt in sorted(OUT_DIR.glob("*.txt")):
        gate = validate_document(txt.read_text(errors="ignore"), seen_fingerprints=seen, **GATE_KWARGS)
        if not gate.ok:
            log.warning("purging legacy junk %s (%s)", txt.name, gate.reason)
            txt.unlink(missing_ok=True)
            txt.with_suffix(".meta.json").unlink(missing_ok=True)
        else:
            existing += 1

    if args.existing_only:
        if existing:
            log.info("offline validation complete · %d valid NTSB documents", existing)
            return 0
        log.error("offline validation found no valid NTSB documents in %s", OUT_DIR)
        return 1

    added = ingest_carol(seen)
    added += ingest_report_pdfs(seen)
    total = existing + added
    log.info(
        "done · %d validated NTSB documents on disk (%d existing, %d added)",
        total,
        existing,
        added,
    )
    if total == 0:
        log.error(
            "ZERO valid NTSB documents ingested. The corpus would be empty; "
            "refusing to pretend otherwise. Check network access, or update "
            "scripts/ntsb_reports.json with current report PDF URLs from "
            "https://www.ntsb.gov/investigations/AccidentReports/Pages/highway.aspx"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
