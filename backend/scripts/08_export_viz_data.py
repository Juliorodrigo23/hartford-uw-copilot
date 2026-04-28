"""Export precomputed viz JSON to frontend/public/data/.

Outputs:
  - embeddings_umap.json     — 3D UMAP of all chunks (point cloud)
  - eval_results.json        — copy of latest eval results
  - submissions_index.json   — compact submission cards for the chat picker
  - monte_carlo.json         — frozen aggregate-loss samples for the viz
  - fmcsa_state_metrics.json — state-level crash density (for the map override)
"""

from __future__ import annotations

import json
import logging
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.ml.risk_simulation import aggregate_loss_distribution  # noqa: E402
from app.tools.submissions import list_submissions  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("08_export_viz")

FRONTEND_DATA = Path(settings.data_dir).parent.parent / "frontend" / "public" / "data"
FRONTEND_DATA.mkdir(parents=True, exist_ok=True)


def export_embeddings_umap():
    """Run UMAP over the BM25 corpus' embeddings (re-using stored embeddings
    is faster, but the corpus file is the source of truth)."""
    from app.rag.embeddings import embed_texts

    bm25_path = settings.data_dir / "processed" / "bm25_corpus.json"
    if not bm25_path.exists():
        log.warning("no bm25 corpus — skipping UMAP export. Run 04_build_index first.")
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
    except Exception as e:
        log.warning("UMAP failed (%s); using PCA fallback", e)
        # PCA fallback
        m = embs.mean(axis=0, keepdims=True)
        X = embs - m
        U, S, Vt = np.linalg.svd(X, full_matrices=False)
        coords = U[:, :3] * S[:3]

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
    out = FRONTEND_DATA / "embeddings_umap.json"
    out.write_text(json.dumps({"points": points}))
    log.info("wrote %s · %d points", out, len(points))


def export_eval_results():
    src = settings.data_dir.parent / "app" / "eval" / "results" / "eval_results.json"
    if src.exists():
        shutil.copy(src, FRONTEND_DATA / "eval_results.json")
        log.info("copied eval_results.json")
    else:
        log.warning("no eval_results to copy — run 07_run_evals first")


def export_submissions_index():
    subs = list_submissions()
    if not subs:
        log.warning("no submissions — run 05_synthesize_subs first")
        return
    items = []
    for s in subs:
        oosv = 0.13
        # Pull from cached SAFER if present
        cache = settings.data_dir / "raw" / "fmcsa" / "safer_cache" / f"{s.dot_number}.json"
        red_flags: list[str] = []
        if cache.exists():
            try:
                p = json.loads(cache.read_text())
                oosv = float(p.get("oos_rate_vehicle") or 0.13)
                if oosv >= 0.20:
                    red_flags.append(f"Vehicle OOS {oosv*100:.0f}%")
                if (p.get("oos_rate_driver") or 0) >= 0.06:
                    red_flags.append(f"Driver OOS {(p['oos_rate_driver'])*100:.0f}%")
            except Exception:
                pass
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
    (FRONTEND_DATA / "submissions_index.json").write_text(json.dumps({"submissions": items}, indent=2))
    log.info("wrote submissions_index.json · %d items", len(items))


def export_monte_carlo():
    """Frozen samples for the MonteCarloLoss visualization."""
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
        # Subsample for transport
        sample = sim.samples
        out.append(
            {
                "profile": p["name"],
                "samples_usd": [float(round(x, 2)) for x in sample[::10]],  # 1000 pts
                "mean_usd": sim.mean,
                "var95_usd": sim.var95,
                "tvar95_usd": sim.tvar95,
                "var99_usd": sim.var99,
            }
        )
    (FRONTEND_DATA / "monte_carlo.json").write_text(json.dumps({"profiles": out}, indent=2))
    log.info("wrote monte_carlo.json")


def main():
    export_eval_results()
    export_submissions_index()
    export_monte_carlo()
    export_embeddings_umap()


if __name__ == "__main__":
    main()
