"""FMCSA carrier lookup.

Two sources, in order:

1. **QCMobile API (primary)** — FMCSA's official JSON API
   (https://mobile.fmcsa.dot.gov/qc). Requires a free webKey
   (https://mobile.fmcsa.dot.gov/QCDevsite/ → register). Set FMCSA_WEBKEY in
   the repo-root .env. Structured, versioned, no scraping.

2. **SAFER Company Snapshot scrape (fallback)** — the legacy HTML page.
   Layout drift on this page previously produced profiles that were all
   parser defaults (status UNKNOWN, ~zero power units, zero crashes) which
   then poisoned the demo data. Defense: `_is_garbage()` rejects any profile
   that looks like parser defaults; garbage is NEVER cached and the lookup
   returns None so callers treat the carrier as unresolved.

Cache: verified profiles only, one JSON per DOT, so the eval suite is
reproducible offline.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from langsmith import traceable
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from app.config import settings
from app.schemas import SAFERProfile

log = logging.getLogger(__name__)

# httpx logs full request URLs at INFO — which would put the webKey into any
# INFO-level log (and did, once). Keep httpx at WARNING.
logging.getLogger("httpx").setLevel(logging.WARNING)

CACHE_DIR = settings.data_dir / "raw" / "fmcsa" / "safer_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

SAFER_URL = "https://safer.fmcsa.dot.gov/query.asp"
QC_URL = "https://mobile.fmcsa.dot.gov/qc/services/carriers/{dot}"


def _cache_path(dot: str) -> Path:
    if not re.fullmatch(r"[0-9]{1,8}", dot):
        raise ValueError("DOT must contain 1 to 8 ASCII digits")
    return CACHE_DIR / f"{dot}.json"


def _is_garbage(p: SAFERProfile) -> bool:
    """Reject profiles that are indistinguishable from parser defaults.

    A real motor carrier snapshot has, at minimum, a known operating status
    or some non-zero activity. A profile with status UNKNOWN, ≤2 power
    units, zero drivers-or-crashes-or-OOS signal is exactly what the HTML
    parser emits when the page layout defeats it — caching it would put a
    print shop behind a 200-truck demo submission again.
    """
    return (
        p.operating_status.upper() in ("UNKNOWN", "")
        and p.power_units <= 2
        and p.crashes_24mo_total == 0
        and p.oos_rate_vehicle == 0.0
        and p.oos_rate_driver == 0.0
    )


# ---------------------------------------------------------------------------
# Primary: QCMobile official API
# ---------------------------------------------------------------------------

def _f(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _i(v, default=0) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _profile_from_qcmobile(payload: dict, dot: str) -> SAFERProfile | None:
    """Map a QCMobile /carriers/{dot} response to SAFERProfile.

    Field names are read defensively (the API has shifted casing across
    versions). OOS rates arrive as percentages; normalized to fractions.
    """
    content = payload.get("content") or {}
    # The API returns `content` as an OBJECT on /carriers/{dot} but as an
    # ARRAY on some deployments/endpoints; accept both.
    if isinstance(content, list):
        content = content[0] if content else {}
    carrier = content.get("carrier") or content  # some responses inline it
    if not isinstance(carrier, dict) or not carrier.get("legalName"):
        log.warning("QCMobile response for DOT %s had no carrier/legalName (keys: %s)",
                    dot, list(payload.keys()))
        return None
    status = carrier.get("statusCode") or carrier.get("carrierOperation", {}).get("carrierOperationDesc")
    allowed = str(carrier.get("allowedToOperate", "")).upper()
    op_status = {
        "A": "AUTHORIZED",
        "I": "INACTIVE",
        "N": "NOT AUTHORIZED",
    }.get(str(status or "").upper(), None) or ("AUTHORIZED" if allowed == "Y" else "UNKNOWN")

    # QCMobile reports OOS rates as PERCENTAGES, always (22.4 means 22.4%,
    # 0.87 means 0.87%). Divide unconditionally: the old "only divide when
    # >1.0" heuristic turned a 0.87% driver OOS rate into an 87% fraction,
    # which then poisoned the cache, the submissions, and every memo.
    oos_v = _f(carrier.get("vehicleOosRate", carrier.get("vehOosRate"))) / 100.0
    oos_d = _f(carrier.get("driverOosRate")) / 100.0
    if oos_v > 0.75 or oos_d > 0.75:
        log.warning(
            "implausible OOS rates for DOT %s (veh=%.2f, drv=%.2f as fractions) — "
            "check the QCMobile field units", dot, oos_v, oos_d,
        )

    profile = SAFERProfile(
        legal_name=str(carrier.get("legalName") or carrier.get("dbaName") or "(unknown)"),
        operating_status=op_status,
        power_units=_i(carrier.get("totalPowerUnits", carrier.get("totPowerUnits"))),
        drivers=_i(carrier.get("totalDrivers", carrier.get("totDrivers"))),
        crashes_24mo_total=_i(carrier.get("crashTotal")),
        crashes_24mo_fatal=_i(carrier.get("fatalCrash")),
        crashes_24mo_injury=_i(carrier.get("injCrash")),
        crashes_24mo_towaway=_i(carrier.get("towawayCrash")),
        oos_rate_vehicle=oos_v,
        oos_rate_driver=oos_d,
        oos_rate_hazmat=None,
        basic_violations={},  # BASICs come from the /basics endpoint below
        raw_dot=dot,
    )
    return profile


async def _fetch_basics_qcmobile(client: httpx.AsyncClient, dot: str, webkey: str) -> dict[str, str]:
    """BASIC percentile summary from QCMobile /carriers/{dot}/basics."""
    try:
        r = await client.get(
            QC_URL.format(dot=dot) + "/basics", params={"webKey": webkey}, timeout=15
        )
        if r.status_code != 200:
            return {}
        out: dict[str, str] = {}
        for item in (r.json().get("content") or []):
            b = item.get("basic") or item
            name = ((b.get("basicsType") or {}).get("basicsShortDesc")) or b.get("basicsTypeDesc")
            pct = b.get("basicsPercentile")
            exceeded = str(b.get("exceededFMCSAInterventionThreshold", "")).upper()
            if name:
                label = f"percentile {pct}" if pct not in (None, "") else "measured"
                if exceeded == "Y":
                    label += " · ABOVE INTERVENTION THRESHOLD"
                out[str(name)] = label
        return out
    except Exception as e:
        log.warning("QCMobile basics fetch failed for %s: %s", dot, e)
        return {}


async def _lookup_qcmobile(dot: str) -> SAFERProfile | None:
    webkey = settings.fmcsa_webkey
    if not webkey:
        log.info("FMCSA_WEBKEY not set — skipping QCMobile, using SAFER scrape")
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(QC_URL.format(dot=dot), params={"webKey": webkey})
            if r.status_code == 404:
                log.info("QCMobile: DOT %s not found (404)", dot)
                return None
            if r.status_code in (401, 403):
                log.error("QCMobile rejected the webKey (HTTP %s) — check FMCSA_WEBKEY in .env", r.status_code)
                return None
            if r.status_code != 200:
                log.warning("QCMobile returned %s for DOT %s: %s", r.status_code, dot, r.text[:200])
                return None
            profile = _profile_from_qcmobile(r.json(), dot)
            if profile is None:
                return None
            profile = profile.model_copy(
                update={"basic_violations": await _fetch_basics_qcmobile(client, dot, webkey)}
            )
            return profile
    except Exception as e:
        log.warning("QCMobile lookup failed for %s: %s", dot, e)
        return None


# ---------------------------------------------------------------------------
# Fallback: SAFER Company Snapshot scrape
# ---------------------------------------------------------------------------

def _parse_snapshot(html: str, dot: str) -> SAFERProfile | None:
    """Extract fields from the SAFER snapshot HTML (legacy fallback)."""
    if "Record Not Found" in html or "RECORD NOT FOUND" in html or "no record" in html.lower():
        return None

    soup = BeautifulSoup(html, "lxml")

    def field(*labels: str) -> str | None:
        """Find the <td> following a <th> whose text matches any label."""
        for th in soup.find_all("th"):
            txt = (th.get_text() or "").strip().lower().rstrip(":")
            for label in labels:
                if txt == label.lower() or txt.startswith(label.lower()):
                    td = th.find_next("td")
                    if td:
                        return td.get_text(separator=" ", strip=True)
        return None

    legal = field("Legal Name", "DBA Name") or "(unknown)"
    op_status = field("Operating Status", "USDOT Status", "Operating Authority Status") or "UNKNOWN"
    pus = int(_first_int(field("Power Units")) or 0)
    drivers = int(_first_int(field("Drivers", "Total Drivers")) or 0)

    c_total, c_fatal, c_injury, c_tow = _parse_crash_table(soup)
    oos_v, oos_d, oos_h = _parse_oos_rates(soup)

    return SAFERProfile(
        legal_name=legal,
        operating_status=op_status,
        power_units=pus,
        drivers=drivers,
        crashes_24mo_total=c_total,
        crashes_24mo_fatal=c_fatal,
        crashes_24mo_injury=c_injury,
        crashes_24mo_towaway=c_tow,
        oos_rate_vehicle=oos_v or 0.0,
        oos_rate_driver=oos_d or 0.0,
        oos_rate_hazmat=oos_h,
        # The snapshot page does not expose BASIC percentiles; only the
        # QCMobile /basics endpoint provides them. Left empty here — never
        # fabricated.
        basic_violations={},
        raw_dot=dot,
    )


def _parse_crash_table(soup: BeautifulSoup) -> tuple[int, int, int, int]:
    for table in soup.find_all("table", summary=re.compile("Crashes", re.IGNORECASE)):
        rows = table.find_all("tr")
        for r in rows:
            cells = [c.get_text(strip=True) for c in r.find_all("td")]
            if len(cells) >= 4 and all(re.fullmatch(r"\d+", c or "") for c in cells[:4]):
                fatal, injury, tow, total = (int(cells[i]) for i in range(4))
                return total, fatal, injury, tow
    return 0, 0, 0, 0


def _parse_oos_rates(soup: BeautifulSoup) -> tuple[float | None, float | None, float | None]:
    veh = drv = haz = None
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 3:
            continue
        for r in rows:
            head = r.find("th")
            if not head:
                continue
            label = head.get_text(separator=" ", strip=True).lower()
            if "out of service" not in label or "%" not in label:
                continue
            cells = [c.get_text(strip=True) for c in r.find_all("td")]
            pcts = [_first_pct(c) for c in cells]
            if len(pcts) >= 2:
                veh = pcts[0] if pcts[0] is not None else veh
                drv = pcts[1] if pcts[1] is not None else drv
                if len(pcts) >= 3 and pcts[2] is not None:
                    haz = pcts[2]
    return veh, drv, haz


def _first_int(s: str | None) -> str | None:
    if not s:
        return None
    m = re.search(r"(\d+)", s)
    return m.group(1) if m else None


def _first_pct(s: str | None) -> float | None:
    if not s:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", s)
    return (float(m.group(1)) / 100.0) if m else None


@retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=8))
async def _fetch_snapshot(dot: str) -> str | None:
    payload = {
        "searchtype": "ANY",
        "query_type": "queryCarrierSnapshot",
        "query_param": "USDOT",
        "query_string": dot,
    }
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        r = await client.post(SAFER_URL, data=payload, headers={
            "User-Agent": "uw-copilot-demo/0.1 (research, contact 23juliorod@gmail.com)",
        })
        if r.status_code != 200:
            return None
        return r.text


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

@traceable(name="safer_lookup", run_type="tool")
async def safer_lookup(dot: str) -> SAFERProfile | None:
    """Resolve a DOT number to a VALIDATED carrier profile, or None.

    Order: cache (validated at write time) → QCMobile API → SAFER scrape.
    A profile that fails `_is_garbage` is treated as unresolved: not cached,
    not returned. Callers route unresolved carriers to data_insufficient.
    """
    dot = str(dot).strip()
    if not re.fullmatch(r"[0-9]{1,8}", dot):
        log.warning("invalid DOT number rejected before cache/network access")
        return None
    p = _cache_path(dot)
    if p.exists():
        try:
            cached = SAFERProfile(**json.loads(p.read_text()))
            if not _is_garbage(cached):
                return cached
            log.warning("cached profile for %s fails validation — refetching", dot)
        except Exception:
            log.warning("corrupt safer cache for %s; refetching", dot)

    profile = await _lookup_qcmobile(dot)
    source = "qcmobile"

    if profile is None:
        source = "safer-scrape"
        try:
            html = await _fetch_snapshot(dot)
        except Exception as e:
            log.warning("SAFER fetch failed for %s: %s", dot, e)
            return None
        if not html:
            return None
        profile = _parse_snapshot(html, dot)

    if profile is None:
        return None
    if _is_garbage(profile):
        log.error(
            "DOT %s (%s via %s) parsed to defaults-only data — REJECTED, not cached. "
            "If this is a real carrier, set FMCSA_WEBKEY to use the official API.",
            dot, profile.legal_name, source,
        )
        return None

    p.write_text(profile.model_dump_json(indent=2))
    return profile
