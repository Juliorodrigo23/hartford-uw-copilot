"use client";

/**
 * AblationTable — explicit table view of REAL ablation runs, complementing
 * the chart inside EvalDashboard. Deltas are computed vs the full-system row.
 * Renders a pending card until scripts/07_run_evals.py --ablations has run.
 */

import { useData } from "@/lib/useData";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { AblationRow, EvalResults } from "@/lib/api";

export function AblationTable() {
  const { data, status } = useData<EvalResults>("eval_results.json");

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading ablations…</div>;
  }
  const ab = data?.ablations;
  if (status === "missing" || !ab || ab.status !== "ok" || !ab.rows?.length) {
    return (
      <PendingCard
        title={`Ablation runs pending${ab?.reason ? `: ${ab.reason}` : "."}`}
        command="uv run python scripts/07_run_evals.py --ablations"
      />
    );
  }

  const rows = ab.rows;
  const baseline = rows.find((d) => d.name === "Full system") ?? rows[0];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Ablation table · component on / off · ∆ vs full system
        </div>
        <DataBadge kind="live" />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-bg-panel/60 text-2xs uppercase tracking-[0.16em] text-ink-dim">
            <tr>
              <th className="px-4 py-2 text-left">Configuration</th>
              <th className="px-4 py-2 text-right">recall@10</th>
              <th className="px-4 py-2 text-right">red-flag recall</th>
              <th className="px-4 py-2 text-right">hallucinations / memo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="px-4 py-2 text-ink">
                  {r === baseline ? <span className="font-semibold text-brand-400">{r.name}</span> : r.name}
                </td>
                {r.status !== "ok" ? (
                  <td colSpan={3} className="px-4 py-2 text-right font-mono text-2xs text-warn-400">
                    not run{r.reason ? ` · ${r.reason}` : ""}
                  </td>
                ) : (
                  <>
                    <PctTd
                      value={r.retrieval_recall_at_10 ?? null}
                      delta={
                        r === baseline || r.retrieval_recall_at_10 == null || baseline.retrieval_recall_at_10 == null
                          ? undefined
                          : r.retrieval_recall_at_10 - baseline.retrieval_recall_at_10
                      }
                    />
                    <PctTd
                      value={r.redflag_recall ?? null}
                      delta={r === baseline ? undefined : (r.redflag_recall ?? 0) - (baseline.redflag_recall ?? 0)}
                    />
                    <NumTd
                      value={r.hallucination_rate ?? null}
                      delta={r === baseline ? undefined : (r.hallucination_rate ?? 0) - (baseline.hallucination_rate ?? 0)}
                      lowerIsBetter
                    />
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border p-3 text-2xs text-ink-dim">
        Each row disables one component via a state flag on the real LangGraph
        run and re-executes the task-level eval end to end.
      </div>
    </div>
  );
}

function PctTd({ value, delta }: { value: number | null; delta?: number }) {
  if (value == null) return <td className="px-4 py-2 text-right font-mono text-ink-dim">—</td>;
  const positive = (delta ?? 0) > 0;
  const dColor = delta == null ? "text-ink-dim" : positive ? "text-accent-400" : "text-brand-400";
  return (
    <td className="px-4 py-2 text-right font-mono tabular-nums">
      <span className="text-ink">{(value * 100).toFixed(1)}%</span>
      {delta != null && (
        <span className={`ml-2 ${dColor}`}>
          {delta >= 0 ? "+" : ""}
          {(delta * 100).toFixed(1)}
        </span>
      )}
    </td>
  );
}

function NumTd({
  value,
  delta,
  lowerIsBetter,
}: {
  value: number | null;
  delta?: number;
  lowerIsBetter?: boolean;
}) {
  if (value == null) return <td className="px-4 py-2 text-right font-mono text-ink-dim">—</td>;
  const good = lowerIsBetter ? (delta ?? 0) < 0 : (delta ?? 0) > 0;
  const dColor = delta == null ? "text-ink-dim" : good ? "text-accent-400" : "text-brand-400";
  return (
    <td className="px-4 py-2 text-right font-mono tabular-nums">
      <span className="text-ink">{value.toFixed(2)}</span>
      {delta != null && (
        <span className={`ml-2 ${dColor}`}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(2)}
        </span>
      )}
    </td>
  );
}
