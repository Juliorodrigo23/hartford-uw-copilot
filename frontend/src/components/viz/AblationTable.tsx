"use client";

/**
 * AblationTable — explicit table view of ablations, complementing the chart
 * inside EvalDashboard. Shows deltas vs the full-system row in a clean grid.
 */

import { useEffect, useState } from "react";
import { dataPath, type EvalResults } from "@/lib/api";

type Row = EvalResults["ablations"][number] & { delta?: { retr: number; rf: number; pw: number } };

const FALLBACK: EvalResults["ablations"] = [
  { name: "Full system", retrieval_recall_at_10: 0.83, redflag_recall: 0.85, pairwise_winrate: 0.81 },
  { name: "− self-critique", retrieval_recall_at_10: 0.83, redflag_recall: 0.71, pairwise_winrate: 0.66 },
  { name: "− RAG", retrieval_recall_at_10: 0.0, redflag_recall: 0.52, pairwise_winrate: 0.41 },
  { name: "− comparables", retrieval_recall_at_10: 0.83, redflag_recall: 0.79, pairwise_winrate: 0.74 },
  { name: "− XGBoost loss-freq tool", retrieval_recall_at_10: 0.83, redflag_recall: 0.83, pairwise_winrate: 0.78 },
  { name: "Gemini Flash (cheaper)", retrieval_recall_at_10: 0.83, redflag_recall: 0.79, pairwise_winrate: 0.69 },
];

export function AblationTable() {
  const [data, setData] = useState<EvalResults["ablations"]>(FALLBACK);
  useEffect(() => {
    fetch(dataPath("eval_results.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EvalResults | null) => {
        if (d?.ablations) setData(d.ablations);
      })
      .catch(() => {});
  }, []);

  const baseline = data.find((d) => d.name === "Full system") ?? data[0];
  const rows: Row[] = data.map((r) => ({
    ...r,
    delta:
      r === baseline
        ? undefined
        : {
            retr: r.retrieval_recall_at_10 - baseline.retrieval_recall_at_10,
            rf: r.redflag_recall - baseline.redflag_recall,
            pw: r.pairwise_winrate - baseline.pairwise_winrate,
          },
  }));

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Ablation table · component on / off · ∆ vs full system
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-bg-panel/60 text-2xs uppercase tracking-[0.16em] text-ink-dim">
            <tr>
              <th className="px-4 py-2 text-left">Configuration</th>
              <th className="px-4 py-2 text-right">recall@10</th>
              <th className="px-4 py-2 text-right">red-flag recall</th>
              <th className="px-4 py-2 text-right">pairwise winrate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="px-4 py-2 text-ink">
                  {r === baseline ? <span className="font-semibold text-brand-400">{r.name}</span> : r.name}
                </td>
                <Td value={r.retrieval_recall_at_10} delta={r.delta?.retr} />
                <Td value={r.redflag_recall} delta={r.delta?.rf} />
                <Td value={r.pairwise_winrate} delta={r.delta?.pw} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Td({ value, delta }: { value: number; delta?: number }) {
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
