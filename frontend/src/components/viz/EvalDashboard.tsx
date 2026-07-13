"use client";

/**
 * EvalDashboard — three-track evaluation summary.
 *  Track 1: Retrieval — recall@k, MRR, nDCG.
 *  Track 2: Generation — LLM-as-judge rubric (GPT-4o judge, Gemini generator).
 *  Track 3: Task-level — ground-truth memo comparison.
 *
 * Loads /data/eval_results.json (written by backend script 07). Every track
 * carries an explicit status; a track that hasn't run renders an explicit
 * pending card with the command to run — NEVER placeholder numbers.
 */

import { motion } from "framer-motion";
import * as Tabs from "@radix-ui/react-tabs";
import { useData } from "@/lib/useData";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { EvalResults } from "@/lib/api";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

export function EvalDashboard() {
  const { data, status } = useData<EvalResults>("eval_results.json");

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading eval results…</div>;
  }
  if (status === "missing" || !data) {
    return (
      <PendingCard
        title="Evaluation results have not been generated yet."
        command="uv run python scripts/07_run_evals.py --ablations && uv run python scripts/08_export_viz_data.py"
      />
    );
  }

  const r = data.retrieval;
  const g = data.generation;
  const t = data.task_level;
  const a = data.ablations;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-bg-panel/40 px-3 pt-2">
        <DataBadge kind="live" note={data.generated_at ? `run ${data.generated_at.slice(0, 10)}` : undefined} />
      </div>
      <Tabs.Root defaultValue="retrieval">
        <Tabs.List className="flex flex-wrap gap-1 border-b border-border bg-bg-panel/40 p-2">
          <TabTrigger value="retrieval">Retrieval</TabTrigger>
          <TabTrigger value="generation">Generation · LLM-as-judge</TabTrigger>
          <TabTrigger value="task">Task-level · ground truth</TabTrigger>
          <TabTrigger value="ablations">Ablations</TabTrigger>
        </Tabs.List>

        <Tabs.Content value="retrieval" className="p-4">
          {r.status !== "ok" ? (
            <TrackPending reason={r.reason} command="uv run python scripts/07_run_evals.py" />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
              <div>
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
                  {r.n_questions}-question gold set · top-k retrieval metrics
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <KPI label="recall@5" value={pct(r.recall_at_5!)} />
                  <KPI label="recall@10" value={pct(r.recall_at_10!)} />
                  <KPI label="MRR" value={r.mrr!.toFixed(2)} />
                  <KPI label="nDCG@10" value={r.ndcg_at_10!.toFixed(2)} />
                </div>
              </div>
              <div className="card p-3">
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
                  recall@10 by corpus
                </div>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={r.by_corpus} margin={{ left: 6, right: 6, top: 16 }}>
                      <CartesianGrid stroke="#1f2733" vertical={false} />
                      <XAxis dataKey="corpus" tick={{ fill: "#9aa6b8", fontFamily: "monospace", fontSize: 11 }} />
                      <YAxis domain={[0, 1]} tick={{ fill: "#9aa6b8", fontFamily: "monospace", fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: "#10141b", border: "1px solid #2b3645", color: "#e6ebf2" }} />
                      <Bar dataKey="recall_at_10" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="generation" className="p-4">
          {g.status !== "ok" ? (
            <TrackPending
              reason={g.reason}
              command="OPENAI_API_KEY=<your key in .env> uv run python scripts/07_run_evals.py"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
              <div className="card p-3">
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
                  Rubric · GPT-4o judge · agent vs single-shot baseline · 1-5 scale
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={g.rubric}>
                      <PolarGrid stroke="#1f2733" />
                      <PolarAngleAxis dataKey="dimension" tick={{ fill: "#9aa6b8", fontFamily: "monospace", fontSize: 11 }} />
                      <PolarRadiusAxis domain={[0, 5]} tick={{ fill: "#6c7689" }} stroke="#1f2733" />
                      <Radar dataKey="agent" name="agent" stroke="#dc2626" fill="#dc2626" fillOpacity={0.25} />
                      <Radar dataKey="baseline" name="single-shot baseline" stroke="#9aa6b8" fill="#9aa6b8" fillOpacity={0.12} />
                      <Legend wrapperStyle={{ color: "#9aa6b8", fontFamily: "monospace", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "#10141b", border: "1px solid #2b3645", color: "#e6ebf2" }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="space-y-3">
                <KPI
                  label="pairwise winrate vs baseline"
                  value={pct(g.pairwise_winrate_vs_baseline!)}
                  accent="#34d399"
                />
                <KPI label="judge IQR (lower = less noisy)" value={g.judge_iqr!.toFixed(2)} />
                <KPI label="cases judged" value={String(g.n_cases ?? "—")} />
                <div className="card p-3 text-2xs text-ink-dim">
                  Each memo judged 3× by GPT-4o; median scores reported, IQR
                  measured across all judge runs. Cross-family judging (Gemini
                  generates, GPT-4o evaluates) avoids self-judging bias.
                </div>
              </div>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="task" className="p-4">
          {t.status !== "ok" ? (
            <TrackPending reason={t.reason} command="uv run python scripts/07_run_evals.py" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <KPI label="red-flag recall" value={pct(t.redflag_recall!)} accent="#34d399" />
                <KPI label="hallucinations / memo" value={(t.hallucination_rate!).toFixed(2)} accent="#f87171" />
                <KPI label="cases completed" value={String(t.n_cases ?? "—")} />
              </div>
              <div className="mt-3 text-2xs text-ink-dim">
                Hand-curated submissions, each with expected red flags and
                forbidden claims. Red-flag recall = fraction of material
                exposures the agent surfaced. Hallucinations = forbidden claims
                per memo (claims contradicted by the ground truth).
              </div>
            </>
          )}
        </Tabs.Content>

        <Tabs.Content value="ablations" className="p-4">
          {a.status !== "ok" || !a.rows ? (
            <TrackPending reason={a.reason} command="uv run python scripts/07_run_evals.py --ablations" />
          ) : (
            <>
              <div className="card p-3">
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
                  Ablation runs · component-on / component-off · real agent re-runs
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={a.rows.filter((x) => x.status === "ok")}
                      layout="vertical"
                      margin={{ left: 88, right: 16 }}
                    >
                      <CartesianGrid stroke="#1f2733" />
                      <XAxis type="number" domain={[0, 1]} tick={{ fill: "#9aa6b8", fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fill: "#e6ebf2", fontSize: 11 }} width={140} />
                      <Tooltip contentStyle={{ background: "#10141b", border: "1px solid #2b3645", color: "#e6ebf2" }} />
                      <Legend wrapperStyle={{ color: "#9aa6b8", fontFamily: "monospace", fontSize: 11 }} />
                      <Bar dataKey="redflag_recall" name="red-flag recall" fill="#34d399" />
                      <Bar dataKey="retrieval_recall_at_10" name="retrieval recall@10" fill="#60a5fa" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="mt-3 text-2xs text-ink-dim">
                Each row disables ONE component via a state flag the real graph
                honors, then re-runs the full task-level eval. No projected or
                interpolated numbers.
              </div>
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function TrackPending({ reason, command }: { reason?: string; command: string }) {
  return (
    <div className="flex flex-col items-start gap-2 p-2">
      <DataBadge kind="pending" />
      <div className="text-sm text-ink-muted">
        This track has not produced results yet{reason ? `: ${reason}` : "."}
      </div>
      <code className="rounded bg-bg-subtle/60 px-2 py-1 font-mono text-xs text-ink">{command}</code>
    </div>
  );
}

function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink data-[state=active]:bg-bg-card data-[state=active]:text-ink data-[state=active]:shadow-inner"
    >
      {children}
    </Tabs.Trigger>
  );
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-3"
      style={{ borderColor: accent ? accent + "55" : undefined }}
    >
      <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: accent ?? "#e6ebf2" }}>
        {value}
      </div>
    </motion.div>
  );
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
