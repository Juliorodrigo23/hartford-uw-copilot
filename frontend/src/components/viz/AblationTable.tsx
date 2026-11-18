"use client";
import { useData } from "@/lib/useData";
import type { EvalResults } from "@/lib/api";
const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

/** Paired measured experiments replace the retired v1 keyword-ablation table. */
export function AblationTable() {
  const { data, status } = useData<EvalResults>("eval_results.json");
  if (status === "loading") return <div className="card p-4 text-sm text-ink-dim">Loading experiment comparison…</div>;
  if (!data || data.schema_version !== 2) return <div className="card p-4 text-sm text-ink-dim">Current evidence benchmark results are pending.</div>;
  const rows = [{ name: "Single-shot complete-packet baseline", metrics: data.baseline }, { name: "Agent with retrieval and critique", metrics: data.task_level }];
  return <div className="card overflow-hidden"><div className="border-b border-border p-4 text-sm">Paired experiment comparison · {data.generated_at?.slice(0, 10)}</div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-ink-dim"><tr><th className="p-3">Configuration</th><th>Completed</th><th>Assertion coverage</th><th>Unsupported claims ↓</th><th>Valid JSON</th></tr></thead><tbody>{rows.map(row => <tr key={row.name} className="border-t border-border"><td className="p-3">{row.name}</td><td>{row.metrics?.n_cases}/{row.metrics?.n_expected}</td><td>{pct(row.metrics?.assertion_recall)}</td><td>{pct(row.metrics?.unsupported_claim_rate)}</td><td>{pct(row.metrics?.format_validity)}</td></tr>)}</tbody></table></div><p className="border-t border-border p-3 text-xs text-ink-dim">Both variants use the same frozen synthetic packets and reference assertions. Underwriter validation is pending. This comparison does not isolate the contribution of each component; individual component ablations were not rerun.</p></div>;
}
