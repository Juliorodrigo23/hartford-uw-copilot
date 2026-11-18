"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "@/lib/useData";
import { PendingCard } from "@/components/DataBadge";
import type { EvalResults } from "@/lib/api";

const pct = (v: number | null | undefined) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
function KPI({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded border border-border bg-bg-subtle/40 p-3"><div className="text-xs text-ink-dim">{label}</div><div className="mt-1 font-mono text-2xl text-ink">{value}</div>{detail && <div className="mt-1 text-xs text-ink-dim">{detail}</div>}</div>;
}
function Trigger({ value, children }: { value: string; children: React.ReactNode }) {
  return <Tabs.Trigger value={value} className="rounded px-3 py-2 text-xs text-ink-dim data-[state=active]:bg-bg-subtle data-[state=active]:text-ink">{children}</Tabs.Trigger>;
}

export function EvalDashboard() {
  const { data, status } = useData<EvalResults>("eval_results.json");
  const [split, setSplit] = useState("all");
  if (status === "loading") return <div className="card p-6 text-sm text-ink-dim">Loading evaluation results…</div>;
  if (!data || status === "missing") return <PendingCard title="No measured evaluation results are available." command="uv run python scripts/07_run_evals.py" />;
  if (data.schema_version !== 2) return <div className="card p-6 text-sm text-ink-dim">Historical evaluation from {data.generated_at?.slice(0, 10) || "an unversioned run"}. Its draft retrieval labels and keyword scores are retired. Run the v2 evidence benchmark to publish current results.</div>;
  const { retrieval: r, task_level: t, generation: g, baseline: b, benchmark: bm } = data;
  const cases = (t.per_submission || []).filter(row => split === "all" || row.split === split);
  return <div className="card overflow-hidden">
    <div className="space-y-3 border-b border-border bg-bg-panel/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs uppercase tracking-wider text-accent-400">Measured evaluation · {data.generated_at?.slice(0, 10)}</span>{data.langsmith && <a className="text-xs text-accent-400 underline" href={data.langsmith.dataset_url} target="_blank" rel="noreferrer">Memo experiments in LangSmith ↗</a>}</div>
      <p className="text-sm text-ink">{bm?.version} · {t.n_cases}/{t.n_expected} agent cases completed · {r.n_questions} retrieval questions</p>
      <p className="text-xs text-amber-300">Synthetic packets · references checked against source evidence by the coding agent · underwriter validation pending.</p>
      <p className="text-xs text-ink-dim">The reference labels and scorers changed. These results are not directly comparable with July’s keyword and draft-label scores. {data.configuration?.scope === "smoke" && "This is a limited smoke run, not the complete benchmark."}</p>
      {t.status === "partial" && <p role="alert" className="text-sm text-amber-300">Partial run: {t.failures?.map(f => `${f.id}: ${f.error_type}`).join("; ") || "one or more cases or uploads failed"}. Failed cases are reported separately; they are not silently counted as successful memos.</p>}
    </div>
    <Tabs.Root defaultValue="retrieval">
      <Tabs.List aria-label="Evaluation tracks" className="flex flex-wrap gap-1 border-b border-border p-2"><Trigger value="retrieval">Retrieval</Trigger><Trigger value="quality">Memo quality</Trigger><Trigger value="cases">Cases & holdout</Trigger><Trigger value="method">Method & versions</Trigger></Tabs.List>
      <Tabs.Content value="retrieval" className="space-y-4 p-4">
        {data.langsmith?.retrieval_dataset_url && <a className="text-xs text-accent-400 underline" href={data.langsmith.retrieval_dataset_url} target="_blank" rel="noreferrer">Inspect retrieval scores and source traces in LangSmith ↗</a>}
        <p className="text-xs text-ink-dim">{r.n_answerable} answerable reference questions and {r.n_no_evidence} explicit missing-source checks. Recall measures recovery of the specified supporting passages; labels are not exhaustive relevance judgments.</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><KPI label="Passage recall @ 5" value={pct(r.recall_at_5)} /><KPI label="Passage recall @ 10" value={pct(r.recall_at_10)} /><KPI label="MRR" value={r.mrr?.toFixed(3) ?? "—"} /><KPI label="nDCG @ 10" value={r.ndcg_at_10?.toFixed(3) ?? "—"} /></div>
        <div className="grid gap-3 md:grid-cols-3"><KPI label="Correct no-source response" value={pct(r.abstention_accuracy)} detail={`${r.n_no_evidence} checks; unavailable forms should return no evidence`} /><KPI label="Development recall @ 10" value={pct(r.by_split?.development?.recall_at_10)} /><KPI label="Holdout recall @ 10" value={pct(r.by_split?.holdout?.recall_at_10)} /></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-ink-dim"><tr><th className="p-2">Reference corpus</th><th>Questions</th><th>Recall @ 10</th></tr></thead><tbody>{r.by_corpus?.map(row => <tr key={row.corpus} className="border-t border-border"><td className="p-2">{row.corpus}</td><td>{row.n}</td><td>{pct(row.recall_at_10)}</td></tr>)}</tbody></table></div>
        <details className="text-xs"><summary className="cursor-pointer text-accent-400">Inspect every retrieval question</summary><div className="mt-3 space-y-3">{r.per_question?.map(q => <div key={q.id} className="rounded border border-border p-3"><p>{q.id} · {q.split} · {q.query}</p><p className="mt-1 text-ink-dim">{q.abstention_correct == null ? `Recall @ 10: ${pct(q.recall_at_10)}` : `No-source check: ${q.abstention_correct ? "passed" : "failed"}`}</p><p className="mt-1 break-all text-ink-dim">Reference: {q.reference_ids.join(", ") || "no supporting form available"}</p></div>)}</div></details>
      </Tabs.Content>
      <Tabs.Content value="quality" className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><KPI label="Evidence assertion coverage" value={pct(t.assertion_recall)} detail={`${t.assertions_met}/${t.assertions_total} source-linked assertions`} /><KPI label="Unsupported factual claims ↓" value={pct(t.unsupported_claim_rate)} detail={`${t.unsupported_claims}/${t.claims_checked} material claims checked`} /><KPI label="Valid external citation IDs" value={pct(t.citation_validity)} detail={`${t.references_used} citation occurrences; validity is not proof of support`} /><KPI label="Valid disposition JSON" value={pct(t.format_validity)} /></div>
        <p className="text-xs text-ink-dim">Assertion coverage and claim support are GPT-4o judgments with recorded reasons, not keyword matches. Citation IDs and JSON structure are checked by code. Correctly disclosed missing documents are evaluated separately from memo errors.</p>
        <div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={g.rubric} margin={{ top: 12, right: 12, left: -22, bottom: 25 }}><CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" /><XAxis dataKey="dimension" tick={{ fontSize: 10, fill: "#a1a1aa" }} interval={0} angle={-12} textAnchor="end" /><YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: "#a1a1aa" }} /><Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5" }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="baseline" name="Single-shot baseline" fill="#64748b" radius={[3, 3, 0, 0]} /><Bar dataKey="agent" name="Agent with retrieval & review" fill="#34d399" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        <p className="text-xs text-ink-dim">{g.baseline_description}. The same frozen cases and evidence-aware grading criteria are used for both variants. No pairwise win rate is inferred from rubric averages.</p>
        <div className="grid grid-cols-2 gap-3"><KPI label="Baseline assertion coverage" value={pct(b?.assertion_recall)} /><KPI label="Baseline unsupported claims ↓" value={pct(b?.unsupported_claim_rate)} /></div>
      </Tabs.Content>
      <Tabs.Content value="cases" className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3"><KPI label="Development assertion coverage" value={pct(t.by_split?.development?.assertion_recall)} detail={`${t.by_split?.development?.n_cases ?? 0} cases`} /><KPI label="Carrier-disjoint holdout coverage" value={pct(t.by_split?.holdout?.assertion_recall)} detail={`${t.by_split?.holdout?.n_cases ?? 0} cases`} /></div>
        <label className="flex items-center gap-2 text-xs">Show cases <select className="rounded border border-border bg-bg-panel p-2" value={split} onChange={e => setSplit(e.target.value)}><option value="all">All</option><option value="development">Development</option><option value="holdout">Holdout</option></select></label>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-ink-dim"><tr><th className="p-2">Case</th><th>Split</th><th>Assertions</th><th>Unsupported claims</th><th>Account review</th><th>Evidence</th></tr></thead><tbody>{cases.map(row => <tr key={row.id} className="border-t border-border"><td className="p-2">{row.id}</td><td>{row.split}</td><td>{row.assertions_met}/{row.assertions_total}</td><td>{row.unsupported_claims}/{row.claims_checked}</td><td>{row.review_status.replaceAll("_", " ")}</td><td className="py-3">{row.trace_url && <a className="text-accent-400 underline" href={row.trace_url} target="_blank" rel="noreferrer">Trace & grading ↗</a>}</td></tr>)}</tbody></table></div>
        <p className="text-xs text-ink-dim">A complete, well-supported memo can still require human underwriting review because verified documents are missing. Source assertions do not label a quote or decline as actuarially correct.</p>
      </Tabs.Content>
      <Tabs.Content value="method" className="space-y-4 p-4 text-xs text-ink-dim">
        <p>Generator: <span className="text-ink">{data.configuration?.generator}</span> · Reviewer: <span className="text-ink">{data.configuration?.reviewer}</span> · Evaluator: <span className="text-ink">{data.configuration?.grader}</span></p>
        <p>Frozen task examples: {bm?.n_task_cases}. Development: {bm?.splits.development}; holdout: {bm?.splits.holdout}. Carrier identities do not cross those task splits.</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{Object.entries(bm?.corpus_counts || {}).map(([source, count]) => <KPI key={source} label={`${source} reference chunks`} value={String(count)} />)}</div>
        <p>The eight FMCSA excerpts are source-linked supplemental lexical references. They are not licensed policy forms or newly embedded Chroma vectors.</p>
        <ul className="list-disc space-y-2 pl-4">{bm?.limitations.map(note => <li key={note}>{note}</li>)}</ul>
        <p>Component ablations: {data.ablations.reason}</p>
        <dl className="space-y-2 break-all"><dt>Task reference fingerprint</dt><dd className="font-mono">{bm?.task_sha256}</dd><dt>Retrieval reference fingerprint</dt><dd className="font-mono">{bm?.retrieval_sha256}</dd><dt>Corpus fingerprint</dt><dd className="font-mono">{bm?.corpus_sha256}</dd><dt>Evaluation source fingerprint</dt><dd className="font-mono">{data.configuration?.code_sha256}</dd></dl>
      </Tabs.Content>
    </Tabs.Root>
  </div>;
}
