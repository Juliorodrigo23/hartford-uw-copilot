"""Export precomputed viz JSON.

Every export is REAL pipeline output. An export whose prerequisites are
missing is skipped with a log line; it is never replaced with invented
numbers. The frontend shows a pending state for missing files.

Writes to BOTH:
  - backend/data/exports/         (ships in the Docker image; served by GET /data/{name})
  - frontend/public/data/         (served statically by Vercel), when present

Outputs:
  - eval_results.json        — copy of the latest eval run (script 07)
  - submissions_index.json   — compact submission cards for the chat picker
  - monte_carlo.json         — frozen aggregate-loss samples (risk_simulation)
  - model_insights.json      — trained-model truth: global SHAP importance,
                               a real single-submission waterfall, isotonic
                               calibration curve, CV metrics, version ablations
  - loss_landscape.json      — per-year frequency/severity points from the
                               synthesized loss runs
  - retrieval_example.json   — real per-stage rankings (BM25/dense/RRF/rerank)
                               for two golden queries          [needs index]
  - chunking_example.json    — real semantic-chunker boundaries on a real
                               NTSB narrative                  [needs corpus + embed model]
  - embeddings_umap.json     — 3D UMAP of all chunks           [needs corpus + embed model]
  - fars_state_metrics.json  — real NHTSA FARS fatal-crash counts by state
                               [needs network; --with-fars]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.compat import apply_platform_workarounds  # noqa: E402

apply_platform_workarounds()  # BEFORE torch/onnx imports (macOS OpenMP clash)

from app.config import settings  # noqa: E402
from app.ml.risk_simulation import aggregate_loss_distribution  # noqa: E402
from app.tools.submissions import list_submissions  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("08_export_viz")

FRONTEND_DATA = Path(settings.data_dir).parent.parent / "frontend" / "public" / "data"
EXPORTS = settings.exports_dir


def _write(name: str, payload: dict) -> None:
    EXPORTS.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload)
    (EXPORTS / name).write_text(text)
    if FRONTEND_DATA.parent.exists():
        FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
        (FRONTEND_DATA / name).write_text(text)
    log.info("wrote %s", name)


# ---------------------------------------------------------------------------


def export_eval_results():
    src = settings.data_dir.parent / "app" / "eval" / "results" / "eval_results.json"
    if not src.exists():
        log.warning("skip eval_results.json — run scripts/07_run_evals.py first")
        return
    _write("eval_results.json", json.loads(src.read_text()))


def export_submissions_index():
    subs = list_submissions()
    if not subs:
        log.warning("skip submissions_index.json — run scripts/05_synthesize_subs.py first")
        return
    items = []
    for s in subs:
        red_flags: list[str] = []
        cache = settings.data_dir / "raw" / "fmcsa" / "safer_cache" / f"{s.dot_number}.json"
        if cache.exists():
            try:
                p = json.loads(cache.read_text())
                oosv = float(p.get("oos_rate_vehicle") or 0)
                oosd = float(p.get("oos_rate_driver") or 0)
                if oosv >= 0.20:
                    red_flags.append(f"Vehicle OOS {oosv*100:.0f}%")
                if oosd >= 0.06:
                    red_flags.append(f"Driver OOS {oosd*100:.0f}%")
            except Exception as e:
                log.warning("bad safer cache for %s: %s", s.dot_number, e)
        if s.commodity == "hazmat":
            red_flags.append("Hazmat")
        loss_total = sum(int(l.incurred_usd) for l in s.loss_run)
        loss_count = sum(l.claims for l in s.loss_run)
        items.append(
            {
                "id": s.id,
                "carrier_name": s.carrier_name,
                "dot_number": s.dot_number,
                "fleet_size": s.fleet_size,
                "states_of_operation": s.states_of_operation,
                "loss_summary": (
                    f"5-yr · {loss_count} claims · ${loss_total/1_000_000:.1f}M incurred"
                    if loss_count
                    else "no loss runs on file"
                ),
                "red_flags": red_flags,
            }
        )
    _write("submissions_index.json", {"submissions": items})


def export_monte_carlo():
    profiles = [
        {"name": "Clean fleet · 200 PUs", "lambda": 2.4, "mu": 11.0, "sigma": 1.05},
        {"name": "Adverse fleet · 200 PUs · high OOS", "lambda": 5.7, "mu": 11.4, "sigma": 1.20},
    ]
    out = []
    for p in profiles:
        sim = aggregate_loss_distribution(
            lambda_claims=p["lambda"],
            severity_mu_log=p["mu"],
            severity_sigma_log=p["sigma"],
            n_sims=10_000,
            seed=42,
        )
        out.append(
            {
                "profile": p["name"],
                "samples_usd": [float(round(x, 2)) for x in sim.samples[::10]],  # 1000 pts
                "mean_usd": sim.mean,
                "var95_usd": sim.var95,
                "tvar95_usd": sim.tvar95,
                "var99_usd": sim.var99,
            }
        )
    _write("monte_carlo.json", {"profiles": out})


def export_model_insights():
    """Everything the model-related visuals need, from the REAL artifacts."""
    meta_path = settings.artifacts_dir / "model_meta.json"
    if not meta_path.exists():
        log.warning("skip model_insights.json — run scripts/06_train_xgb.py first")
        return
    meta = json.loads(meta_path.read_text())

    # A real waterfall for one real submission (the first with a cached SAFER
    # profile), computed with the production predict path.
    waterfall = None
    try:
        from app.schemas import SAFERProfile
        from app.tools.xgb_loss_freq import xgb_predict

        for s in list_submissions():
            cache = settings.data_dir / "raw" / "fmcsa" / "safer_cache" / f"{s.dot_number}.json"
            if not cache.exists():
                continue
            safer = SAFERProfile(**json.loads(cache.read_text()))
            pred = xgb_predict(s, safer)
            if pred.source != "xgboost":
                break  # no trained model; don't fake a waterfall
            waterfall = {
                "submission_id": s.id,
                "dot_number": s.dot_number,
                "pred_claims_next_yr": pred.pred_claims_next_yr,
                "pi_80": list(pred.pi_80),
                "base_value": meta.get("base_value"),
                "features": pred.shap_top,
                "model_version": pred.model_version,
            }
            break
    except Exception as e:
        log.warning("waterfall export failed: %s", e)

    _write(
        "model_insights.json",
        {
            "version": meta.get("version"),
            "training_data": meta.get("training_data"),
            "n_train": meta.get("n_train"),
            "cv_metrics": meta.get("cv_metrics"),
            "model_versions": meta.get("model_versions"),
            "calibration": meta.get("calibration"),
            "global_importance": meta.get("global_importance"),
            "waterfall": waterfall,
        },
    )


def export_loss_landscape():
    """Real per-year (frequency, severity) points from the synthesized loss
    runs — the data the loss-inflation visual plots."""
    subs = list_submissions()
    if not subs:
        log.warning("skip loss_landscape.json — no submissions")
        return
    points = []
    for s in subs:
        for l in s.loss_run:
            if l.claims <= 0:
                continue
            points.append(
                {
                    "year": l.year,
                    "f": round(l.claims / max(1, s.fleet_size), 5),
                    "s": round(float(l.incurred_usd) / l.claims / 1000.0, 1),  # $K per claim
                    "id": s.id,
                }
            )
    _write("loss_landscape.json", {"points": points, "source": "synthesized loss runs (script 05)"})


def export_retrieval_example():
    from app.rag.hybrid_search import search_stages

    golden = settings.data_dir.parent / "app" / "eval" / "golden_set" / "retrieval_questions.json"
    if not golden.exists():
        log.warning("skip retrieval_example.json — no golden set")
        return
    qs = json.loads(golden.read_text())["questions"][:2]
    stages = []
    for q in qs:
        st = search_stages(q["query"], k=10)
        if not (st["bm25"] or st["dense"]):
            log.warning("skip retrieval_example.json — index empty (run scripts/02-04)")
            return
        stages.append(st)
    _write("retrieval_example.json", {"queries": stages})


def export_chunking_example():
    """Real chunk boundaries from the real chunker on a real corpus doc."""
    from app.rag.chunker import semantic_chunks
    from app.rag.embeddings import embed_texts

    ntsb_dir = settings.data_dir / "raw" / "ntsb"
    docs = sorted(ntsb_dir.glob("*.txt")) if ntsb_dir.exists() else []
    if not docs:
        log.warning("skip chunking_example.json — no NTSB corpus (run scripts/02)")
        return
    text = docs[0].read_text(errors="ignore")[:4000]
    chunks = semantic_chunks(text, embed_fn=embed_texts, target_tokens=60, overlap_tokens=12)
    _write(
        "chunking_example.json",
        {
            "doc_id": docs[0].stem,
            "text": text,
            "chunks": [
                {"start": c.start, "end": c.end, "tokens": len(c.text.split())} for c in chunks
            ],
        },
    )


def export_embeddings_umap():
    from app.rag.embeddings import embed_texts

    bm25_path = settings.data_dir / "processed" / "bm25_corpus.json"
    if not bm25_path.exists():
        log.warning("skip embeddings_umap.json — run scripts/04_build_index.py first")
        return

    raw = json.loads(bm25_path.read_text())
    docs = raw["docs"][:1500]
    if not docs:
        return

    log.info("embedding %d chunks for UMAP", len(docs))
    embs = embed_texts([d["text"] for d in docs])

    try:
        import umap

        reducer = umap.UMAP(n_components=3, random_state=42, n_neighbors=20, min_dist=0.08)
        coords = reducer.fit_transform(embs)
        method = "umap"
    except Exception as e:
        log.warning("UMAP failed (%s); using PCA fallback", e)
        m = embs.mean(axis=0, keepdims=True)
        X = embs - m
        U, S, Vt = np.linalg.svd(X, full_matrices=False)
        coords = U[:, :3] * S[:3]
        method = "pca"

    points = []
    for d, c in zip(docs, coords, strict=False):
        points.append(
            {
                "x": float(c[0]),
                "y": float(c[1]),
                "z": float(c[2]),
                "src": d.get("source", "unknown"),
                "doc_id": d.get("doc_id", d.get("id")),
                "snippet": d["text"][:240],
            }
        )
    _write("embeddings_umap.json", {"points": points, "method": method})


async def export_fars_state_metrics(year: int):
    from app.tools.fars_query import (
        STATE_FIPS,
        fars_state_counts,
        fars_state_counts_from_csv,
    )

    source = "NHTSA FARS CrashAPI"
    counts = await fars_state_counts(year)
    if len(counts) < 40:
        # The CrashAPI's WAF often 403s programmatic clients. Fall back to
        # the official FARS yearly microdata CSV (the primary source behind
        # the API): one cached download, counted locally.
        log.warning(
            "CrashAPI resolved only %d/51 states — falling back to the FARS "
            "national CSV archive", len(counts),
        )
        try:
            counts = fars_state_counts_from_csv(year)
            source = f"NHTSA FARS {year} national microdata (accident.csv)"
        except Exception as e:
            log.error("skip fars_state_metrics.json — CSV fallback failed too: %s", e)
            return
    if len(counts) < 40:
        log.error("skip fars_state_metrics.json — only %d/51 states resolved", len(counts))
        return
    states = [
        {"id": fips, "name": STATE_FIPS[fips][0], "abbr": STATE_FIPS[fips][1], "fatal_crashes": n}
        for fips, n in sorted(counts.items())
    ]
    _write(
        "fars_state_metrics.json",
        {"year": year, "states": states, "source": source},
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--with-fars", action="store_true", help="Also export NHTSA FARS state counts (network, ~30s)")
    parser.add_argument("--fars-year", type=int, default=2022)
    parser.add_argument("--skip-umap", action="store_true", help="Skip the UMAP export (slow on CPU)")
    args = parser.parse_args()

    export_eval_results()
    export_submissions_index()
    export_monte_carlo()
    export_model_insights()
    export_loss_landscape()
    export_retrieval_example()
    export_chunking_example()
    if not args.skip_umap:
        export_embeddings_umap()
    if args.with_fars:
        asyncio.run(export_fars_state_metrics(args.fars_year))


if __name__ == "__main__":
    main()
