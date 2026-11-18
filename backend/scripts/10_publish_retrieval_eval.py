"""Publish measured retrieval traces as a linked LangSmith experiment.

Uses actual query timings/outputs from the full evaluation; never manufactures
retrieval executions or reuses the retired July labels.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.eval.benchmark import load_benchmark
from app.observability.tracing import tracing_client


def publish(report: dict) -> dict:
    client = tracing_client()
    if client is None:
        raise ValueError("LangSmith is not configured")
    project = report["langsmith"]["experiments"]["agent"]
    measured = list(
        client.list_runs(project_id=project["id"], is_root=True, run_type="retriever", limit=100)
    )
    by_query = {r.inputs.get("query"): r for r in measured if r.end_time and not r.error}
    refs = {q["id"]: q for q in load_benchmark("retrieval_questions")["questions"]}
    rows = []
    for result in report["retrieval"]["per_question"]:
        run = by_query.get(result["query"])
        if run is None:
            raise ValueError("A measured retrieval trace is missing: " + result["id"])
        source_outputs = (run.outputs or {}).get("output", [])
        ids = [d["doc_id"] for d in source_outputs]
        if ids != result["retrieved_ids"]:
            raise ValueError("Report and measured retrieval trace disagree: " + result["id"])
        reference = refs[result["id"]]
        scores = []
        for metric in ["recall_at_5", "recall_at_10", "mrr", "ndcg_at_10", "abstention_correct"]:
            if metric in result:
                scores.append(
                    {
                        "key": metric,
                        "score": round(float(result[metric]), 4),
                        "feedback_source": {"type": "api"},
                        "comment": "Deterministic v2 reference-passage check; agent source checked, underwriter validation pending.",
                    }
                )
        rows.append(
            {
                "row_id": str(
                    uuid5(NAMESPACE_URL, report["benchmark"]["retrieval_sha256"] + result["id"])
                ),
                "inputs": {"query": result["query"]},
                "expected_outputs": {
                    "references": reference["references"],
                    "expected_abstention": reference.get("expected_abstention", False),
                    "corpus": reference["corpus"],
                },
                "actual_outputs": {"retrieved_ids": ids, "results": source_outputs},
                "evaluation_scores": scores,
                "start_time": run.start_time.isoformat(),
                "end_time": run.end_time.isoformat(),
                "run_name": "measured-hybrid-retrieval-v2",
                "run_metadata": {
                    "source_trace_id": str(run.id),
                    "split": result["split"],
                    "review_status": report["benchmark"]["review_status"],
                },
            }
        )
    dataset_name = "uw-retrieval-v2-" + report["benchmark"]["retrieval_sha256"][:12]
    name = "uw-retrieval-" + report["evaluation_key"]
    body = {
        "experiment_name": name,
        "dataset_name": dataset_name,
        "dataset_description": "Frozen source-checked reference passages and explicit no-source cases. Underwriter validation pending.",
        "experiment_start_time": min(r["start_time"] for r in rows),
        "experiment_end_time": max(r["end_time"] for r in rows),
        "experiment_metadata": {
            "benchmark": report["benchmark"],
            "configuration": report["configuration"],
            "source_experiment_id": project["id"],
        },
        "summary_experiment_scores": [
            {
                "key": key,
                "score": round(float(report["retrieval"][key]), 4),
                "feedback_source": {"type": "api"},
            }
            for key in ["recall_at_5", "recall_at_10", "mrr", "ndcg_at_10", "abstention_accuracy"]
            if report["retrieval"].get(key) is not None
        ],
        "results": rows,
    }
    response = client.request_with_retries("POST", "/api/v1/datasets/upload-experiment", json=body)
    response.raise_for_status()
    result = response.json()
    dataset = result["dataset"]
    experiment = result["experiment"]
    report["langsmith"]["retrieval_dataset_url"] = (
        f"https://smith.langchain.com/o/{settings.langsmith_workspace_id}/datasets/{dataset['id']}"
    )
    report["langsmith"]["retrieval_dataset_id"] = dataset["id"]
    report["langsmith"]["retrieval_experiment_id"] = experiment["id"]
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    try:
        data = publish(json.loads(args.report.read_text()))
        args.report.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False))
        print(
            "Published measured retrieval experiment:", data["langsmith"]["retrieval_dataset_url"]
        )
    except Exception as exc:
        print("Retrieval publication failed:", type(exc).__name__)
        raise SystemExit(1) from None
