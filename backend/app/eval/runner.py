"""One resumable paired evaluation; dataset, traces and feedback in LangSmith."""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import importlib.metadata
import json
import logging
import platform
import statistics
import time
from pathlib import Path
from uuid import NAMESPACE_URL, uuid4, uuid5

from langchain_core.messages import HumanMessage, SystemMessage
from langsmith import traceable, tracing_context
from langsmith.utils import LangSmithNotFoundError

from app.config import settings
from app.eval.benchmark import fingerprint, load_benchmark, manifest
from app.eval.retrieval import evaluate_retrieval
from app.eval.scoring import DIMENSIONS, grade_memo
from app.graph.builder import get_graph
from app.llm.evidence import evidence_hash, evidence_package
from app.llm.prompts.memo import MEMO_SYSTEM
from app.llm.text import response_text
from app.llm.vertex_client import gemini
from app.observability.tracing import flush_traces, tracing_client
from app.rag.hybrid_search import _reranker
from app.schemas import SAFERProfile, Submission

log = logging.getLogger(__name__)
OUT = Path(__file__).with_name("results") / "eval_results.json"


def utc():
    return dt.datetime.now(dt.UTC)


def _code_hash():
    base = Path(__file__).parents[1]
    files = [
        p
        for folder in ["llm", "graph", "rag", "eval", "observability", "tools"]
        for p in (base / folder).rglob("*.py")
    ]
    files += [base / "schemas.py", base / "config.py"]
    return fingerprint(
        [
            (str(p.relative_to(base)), hashlib.sha256(p.read_bytes()).hexdigest())
            for p in sorted(files)
        ]
    )


def setup_langsmith(client, meta: dict, cases: list[dict]) -> dict:
    suffix = fingerprint(meta)[:12]
    dataset_name = f"uw-evidence-v2-{suffix}"
    try:
        dataset = client.read_dataset(dataset_name=dataset_name)
    except LangSmithNotFoundError:
        dataset = client.create_dataset(
            dataset_name,
            description="Frozen synthetic evidence-handling benchmark. Agent source checked; underwriter validation pending.",
            metadata=meta,
        )
    existing = {str(example.id) for example in client.list_examples(dataset_id=dataset.id)}
    example_ids = {
        case["id"]: str(uuid5(NAMESPACE_URL, dataset_name + case["id"])) for case in cases
    }
    new = [
        {
            "id": example_ids[c["id"]],
            "inputs": c["inputs"],
            "outputs": c["reference_outputs"],
            "metadata": c["metadata"],
            "split": c["inputs"]["split"],
        }
        for c in cases
        if example_ids[c["id"]] not in existing
    ]
    if new:
        client.create_examples(dataset_id=dataset.id, examples=new)
    projects = {}
    for variant in ("baseline", "agent"):
        name = f"uw-v2-{variant}-{suffix}"
        try:
            project = client.read_project(project_name=name)
        except LangSmithNotFoundError:
            project = client.create_project(
                name, reference_dataset_id=dataset.id, metadata={**meta, "variant": variant}
            )
        projects[variant] = {"name": project.name, "id": str(project.id)}
    workspace = settings.langsmith_workspace_id
    return {
        "dataset_id": str(dataset.id),
        "dataset_name": dataset.name,
        "dataset_url": f"https://smith.langchain.com/o/{workspace}/datasets/{dataset.id}",
        "examples": example_ids,
        "experiments": projects,
    }


def completed_remote_rows(client, remote: dict, cases: list[dict]) -> dict:
    """Resume a terminated job from its real, completed LangSmith traces."""
    rows = {}
    case_map = {remote["examples"][c["id"]]: c for c in cases}
    for variant, project in remote["experiments"].items():
        for run in client.list_runs(project_id=project["id"], is_root=True, limit=100):
            case = case_map.get(str(run.reference_example_id))
            if (
                not case
                or run.error
                or not run.end_time
                or not run.outputs
                or "scores" not in run.outputs
            ):
                continue
            scores = run.outputs["scores"]
            needed = {
                "assertion_recall",
                "unsupported_claim_rate",
                "citation_validity",
                "format_valid",
            }
            # Do not reuse a trace whose metrics were not successfully published.
            if not all(
                k in (run.feedback_stats or {}) for k in needed if scores.get(k) is not None
            ):
                continue
            rows[(variant, case["id"])] = {
                "id": case["id"],
                "variant": variant,
                "split": case["inputs"]["split"],
                "run_id": str(run.id),
                "started_at": run.start_time.isoformat(),
                "ended_at": run.end_time.isoformat(),
                "elapsed_s": round((run.end_time - run.start_time).total_seconds(), 2),
                "outputs": run.outputs,
                "feedback_published": True,
                "trace_url": client.get_run_url(run=run, project_id=project["id"]),
            }
    return rows


@traceable(name="benchmark-case", run_type="chain")
async def run_case(case: dict, variant: str) -> dict:
    sub = Submission.model_validate(case["inputs"]["submission"])
    if sub is None:
        raise ValueError("Frozen submission missing")
    if variant == "agent":
        state = await get_graph().ainvoke(
            {
                "submission_id": sub.id,
                "user_message": "Triage this submission. Use the complete available packet, distinguish supplied records from missing documents, and cite evidence.",
                "history": [],
                "tool_calls": [],
                "tool_results": [],
                "retrieved": [],
                "citations": [],
                "critique_iters": 0,
                "draft_iters": 0,
                "critique_provider_override": "openai",
                "benchmark_packet": case["inputs"]["submission"],
                "benchmark_safer": case["inputs"]["safer_profile"],
                "benchmark_source_snapshot": case["inputs"]["source_snapshot"],
            },
            config={
                "configurable": {"thread_id": uuid4().hex},
                "run_name": "underwriting-triage",
                "metadata": {"benchmark_case": case["id"], "variant": variant},
            },
        )
        memo = state.get("memo_md", "")
    else:
        profile = case["inputs"]["safer_profile"]
        state = {
            "submission": sub,
            "safer_profile": SAFERProfile.model_validate(profile),
            "source_snapshot": case["inputs"]["source_snapshot"],
            "retrieved": [],
        }
        raw_packet = evidence_package(state)
        prompt = (
            "Write a concise underwriting triage memo from this complete raw packet. No retrieval, analytical tools, or critique pass are available. "
            "Include recommendation, risk drivers, open broker questions, producer summary, and end with a JSON disposition block "
            '{"disposition":"quote|quote_with_surcharge|decline|data_insufficient","confidence":0..1,"drivers":[...]}. '
            "Acknowledge missing verified documents separately from supplied annual aggregates.\n"
            + json.dumps(raw_packet, ensure_ascii=False)
        )
        response = await gemini(temperature=0.2, streaming=False, max_output_tokens=8192).ainvoke(
            [SystemMessage(content=MEMO_SYSTEM), HumanMessage(content=prompt)]
        )
        memo = response_text(response.content)
    if not memo.strip():
        raise ValueError("Empty memo cannot be scored")
    evidence = evidence_package(state)
    scores = await grade_memo(memo, evidence, case["reference_outputs"]["assertions"])
    return {
        "submission_id": sub.id,
        "variant": variant,
        "memo": memo,
        "evidence": evidence,
        "scores": scores,
        "draft_iters": state.get("draft_iters", 1),
        "missing_documents": state.get("missing_documents", []),
        "review_status": "unreviewed"
        if state.get("critique_error")
        else "needs_review"
        if state.get("missing_documents") or not state.get("critique_pass", False)
        else "passed",
        "draft_packet_hash": state.get("draft_packet_hash", evidence_hash(state)),
        "review_packet_hash": state.get("review_packet_hash"),
    }


def aggregate(rows: list[dict], expected: int) -> dict:
    good = [r for r in rows if r.get("outputs")]
    scores = [r["outputs"]["scores"] for r in good]
    total_assertions = sum(s["assertions_total"] for s in scores)
    total_claims = sum(s["claims_checked"] for s in scores)
    used = sum(s["references_used"] for s in scores)
    invalid = sum(
        len(
            __import__("re").findall(
                r"\[(" + "|".join(s["invalid_references"]) + r")\]", r["outputs"]["memo"]
            )
        )
        for s, r in zip(scores, good, strict=True)
        if s["invalid_references"]
    )
    return {
        "status": "ok"
        if len(good) == expected and not any(r.get("error_type") for r in rows)
        else "partial",
        "n_cases": len(good),
        "n_expected": expected,
        "completion_rate": len(good) / expected if expected else None,
        "assertion_recall": sum(s["assertions_met"] for s in scores) / total_assertions
        if total_assertions
        else None,
        "assertions_met": sum(s["assertions_met"] for s in scores),
        "assertions_total": total_assertions,
        "unsupported_claim_rate": sum(s["unsupported_claims"] for s in scores) / total_claims
        if total_claims
        else None,
        "unsupported_claims": sum(s["unsupported_claims"] for s in scores),
        "claims_checked": total_claims,
        "citation_validity": (used - invalid) / used if used else None,
        "references_used": used,
        "format_validity": sum(s["format_valid"] for s in scores) / len(scores) if scores else None,
        "rubric_scores": {
            k: statistics.mean(s["rubric_scores"][k] for s in scores) if scores else None
            for k in DIMENSIONS
        },
        "latency_p50_s": statistics.median(r["elapsed_s"] for r in good) if good else None,
        "failures": [
            {"id": r["id"], "error_type": r["error_type"]} for r in rows if r.get("error_type")
        ],
        "per_submission": [
            {
                "id": r["id"],
                "split": r["split"],
                "run_id": r["run_id"],
                "trace_url": r.get("trace_url"),
                "assertion_recall": r["outputs"]["scores"]["assertion_recall"],
                "unsupported_claim_rate": r["outputs"]["scores"]["unsupported_claim_rate"],
                "assertions_met": r["outputs"]["scores"]["assertions_met"],
                "assertions_total": r["outputs"]["scores"]["assertions_total"],
                "unsupported_claims": r["outputs"]["scores"]["unsupported_claims"],
                "claims_checked": r["outputs"]["scores"]["claims_checked"],
                "review_status": r["outputs"]["review_status"],
            }
            for r in good
        ],
    }


async def run_evaluations(
    *, concurrency: int = 2, limit: int | None = None, publish: bool = True
) -> dict:
    benchmark = manifest()
    import numpy as np

    reranker = _reranker()
    health = "unavailable"
    if reranker is not None:
        probe = np.asarray(
            reranker.predict(
                [("vehicle brake inspection", "The vehicle brakes were inspected for defects.")]
            ),
            dtype=float,
        )
        health = "finite" if np.isfinite(probe).all() else "non_finite_fallback_to_rrf"
    runtime = {
        "system": platform.system(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "libraries": {
            name: importlib.metadata.version(name)
            for name in ["torch", "transformers", "sentence-transformers", "chromadb", "langsmith"]
        },
        "embedding_model": settings.embed_model,
        "reranker_model": settings.reranker_model,
        "reranker_health": health,
    }
    cases = load_benchmark("ground_truth_memos")["cases"]
    if limit:
        cases = cases[:limit]
    meta = {
        "runtime": runtime,
        "benchmark": benchmark,
        "code_sha256": _code_hash(),
        "generator": settings.vertex_model,
        "reviewer": settings.openai_judge_model,
        "grader": settings.openai_judge_model,
        "baseline": "single shot; same complete raw packet; no retrieval, analytical tools or critique",
        "temperature": 0.2,
        "scope": "smoke" if limit else "full",
        "case_ids": [c["id"] for c in cases],
    }
    client = tracing_client() if publish else None
    if publish and client is None:
        raise ValueError(
            "Publishing evaluations requires configured server-side LangSmith tracing."
        )
    remote = await asyncio.to_thread(setup_langsmith, client, meta, cases) if client else None
    resumed = (
        await asyncio.to_thread(completed_remote_rows, client, remote, cases) if client else {}
    )
    key = fingerprint(meta)[:16]
    cache = settings.data_dir / "eval_runs" / key
    cache.mkdir(parents=True, exist_ok=True)
    log.info("benchmark=%s cases=%d cache=%s", key, len(cases), cache)
    retrieval_file = cache / "retrieval.json"
    if retrieval_file.exists():
        retrieval = json.loads(retrieval_file.read_text())
    else:
        with tracing_context(
            enabled=bool(client),
            client=client,
            project_name=remote["experiments"]["agent"]["name"]
            if remote
            else settings.langsmith_project,
        ):
            retrieval = await evaluate_retrieval(split="development" if limit else None)
        retrieval_file.write_text(json.dumps(retrieval, indent=2))
    semaphore = asyncio.Semaphore(concurrency)

    async def one(case, variant):
        async with semaphore:
            if (variant, case["id"]) in resumed:
                log.info("resumed %s %s from verified LangSmith trace", variant, case["id"])
                return resumed[(variant, case["id"])]
            path = cache / f"{variant}-{case['id']}.json"
            if path.exists():
                cached = json.loads(path.read_text())
                if cached.get("outputs") and (not client or cached.get("feedback_published")):
                    log.info("cached %s %s", variant, case["id"])
                    return cached
            run_id = uuid4()
            started = time.monotonic()
            row = {
                "id": case["id"],
                "variant": variant,
                "split": case["inputs"]["split"],
                "run_id": str(run_id),
                "started_at": utc().isoformat(),
            }
            name = remote["experiments"][variant]["name"] if remote else settings.langsmith_project
            try:
                with tracing_context(enabled=bool(client), client=client, project_name=name):
                    outputs = await run_case(
                        case,
                        variant,
                        langsmith_extra={
                            "run_id": run_id,
                            "reference_example_id": remote["examples"][case["id"]]
                            if remote
                            else None,
                            "client": client,
                            "project_name": name,
                            "metadata": {
                                "benchmark_version": benchmark["version"],
                                "split": row["split"],
                                "variant": variant,
                            },
                            "tags": ["evaluation", variant, row["split"]],
                        },
                    )
                row.update(
                    {
                        "outputs": outputs,
                        "elapsed_s": round(time.monotonic() - started, 2),
                        "ended_at": utc().isoformat(),
                    }
                )
                path.write_text(json.dumps(row, indent=2, ensure_ascii=False))
                await flush_traces()
                if client:
                    for metric in [
                        "assertion_recall",
                        "unsupported_claim_rate",
                        "citation_validity",
                        "format_valid",
                    ]:
                        value = outputs["scores"][metric]
                        if value is not None:
                            await asyncio.to_thread(
                                client.create_feedback,
                                run_id=run_id,
                                key=metric,
                                score=float(value),
                                comment="Source-checked synthetic evidence benchmark v2; LLM judgments require human validation.",
                                feedback_id=uuid5(run_id, metric),
                            )
                    stored = await asyncio.to_thread(client.read_run, run_id)
                    row["trace_url"] = client.get_run_url(
                        run=stored, project_id=remote["experiments"][variant]["id"]
                    )
                    row["feedback_published"] = True
                log.info(
                    "done %s %s assertion=%.3f unsupported=%.3f elapsed=%.1fs",
                    variant,
                    case["id"],
                    outputs["scores"]["assertion_recall"],
                    outputs["scores"]["unsupported_claim_rate"],
                    row["elapsed_s"],
                )
            except Exception as exc:
                row.update(
                    {
                        "error_type": type(exc).__name__,
                        "elapsed_s": round(time.monotonic() - started, 2),
                        "ended_at": utc().isoformat(),
                    }
                )
                log.error("failed %s %s (%s)", variant, case["id"], type(exc).__name__)
            path.write_text(json.dumps(row, indent=2, ensure_ascii=False))
            return row

    # Interleave paired examples to expose failures early and bound provider load.
    rows = await asyncio.gather(
        *(one(case, variant) for case in cases for variant in ["baseline", "agent"])
    )
    variants = {
        v: aggregate([r for r in rows if r["variant"] == v], len(cases))
        for v in ["baseline", "agent"]
    }
    task = variants["agent"]
    task["method"] = (
        "Semantic source-checked assertion coverage and unsupported factual-claim rate; deterministic citation-ID and JSON checks."
    )
    task["by_split"] = {
        split: aggregate(
            [r for r in rows if r["variant"] == "agent" and r["split"] == split],
            sum(c["inputs"]["split"] == split for c in cases),
        )
        for split in ["development", "holdout"]
        if any(c["inputs"]["split"] == split for c in cases)
    }
    generation = {
        "status": "ok" if all(v["status"] == "ok" for v in variants.values()) else "partial",
        "n_cases": len(cases),
        "rubric": [
            {
                "dimension": d.replace("_", " ").title(),
                "agent": variants["agent"]["rubric_scores"][d],
                "baseline": variants["baseline"]["rubric_scores"][d],
            }
            for d in DIMENSIONS
        ],
        "baseline_description": meta["baseline"],
        "pairwise_status": "not_run",
        "note": "Absolute evidence-aware rubric on paired cases; no unmeasured pairwise win rate is displayed.",
    }
    report = {
        "schema_version": 2,
        "generated_at": utc().isoformat(),
        "benchmark": benchmark,
        "configuration": meta,
        "retrieval": retrieval,
        "generation": generation,
        "task_level": task,
        "baseline": variants["baseline"],
        "ablations": {
            "status": "skipped",
            "reason": "Component ablations were not rerun; paired single-shot baseline is reported separately.",
        },
        "langsmith": remote,
        "evaluation_key": key,
    }
    if client:
        for p in remote["experiments"].values():
            await asyncio.to_thread(client.update_project, p["id"], end_time=utc(), metadata=meta)
        await flush_traces()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))
    for folder in [
        settings.data_dir / "exports",
        Path(__file__).parents[3] / "frontend" / "public" / "data",
    ]:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "eval_results.json").write_text(OUT.read_text())
    (cache / "report.json").write_text(OUT.read_text())
    return report
