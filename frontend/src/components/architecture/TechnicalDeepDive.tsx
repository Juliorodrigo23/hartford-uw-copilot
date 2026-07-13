import {
  Activity,
  Boxes,
  BrainCircuit,
  ChevronDown,
  DatabaseZap,
  FileJson2,
  Gauge,
} from "lucide-react";

const STATE_GROUPS = [
  {
    label: "Input + parse",
    fields: "submission_id, user_message, history → submission, parse_notes",
    owner: "parse_submission",
  },
  {
    label: "Evidence",
    fields: "safer_profile, retrieved[], citations[], comparables[]",
    owner: "enrich · retrieve · comparables",
  },
  {
    label: "Risk features",
    fields: "loss_stats, xgb_pred",
    owner: "analyze_loss_history",
  },
  {
    label: "Generation",
    fields: "memo_md, draft_iters, memo, disposition",
    owner: "draft_memo · finalize",
  },
  {
    label: "Quality gate",
    fields: "critique_pass, critique_iters, critique_gaps, rubric_scores, critique_judge, critique_error",
    owner: "self_critique",
  },
  {
    label: "Observability",
    fields: "tool_calls[], tool_results[]",
    owner: "every external / model tool",
  },
];

const LATENCIES = [
  { label: "Parse + SAFER", ms: "3 ms", pct: 1, tone: "bg-info-500" },
  { label: "Retrieval passes", ms: "12.70 s", pct: 14, tone: "bg-accent-500" },
  { label: "Loss + comparables", ms: "158 ms", pct: 1, tone: "bg-warn-500" },
  { label: "Two memo drafts", ms: "72.06 s", pct: 82, tone: "bg-brand-600" },
  { label: "Two critiques", ms: "3.44 s", pct: 4, tone: "bg-[#fb923c]" },
  { label: "End-to-end", ms: "88.35 s", pct: 100, tone: "bg-ink-muted" },
];

export function TechnicalDeepDive() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-panel/60">
      <DeepDiveSection icon={FileJson2} eyebrow="STATE CONTRACT" title="Typed state transformations" open>
        <p className="mb-4 max-w-4xl text-sm leading-6 text-ink-muted">
          Each node returns a partial <code className="rounded bg-bg px-1 py-0.5 font-mono text-xs text-ink">AgentState</code> patch.
          The graph composes those patches into a checkpointed run; tool calls are append-only so evidence and timing remain inspectable.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-bg text-ink-dim">
              <tr>
                <th className="px-4 py-3 font-mono font-normal uppercase tracking-[.12em]">state slice</th>
                <th className="px-4 py-3 font-mono font-normal uppercase tracking-[.12em]">fields / transformation</th>
                <th className="px-4 py-3 font-mono font-normal uppercase tracking-[.12em]">writer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-bg-card">
              {STATE_GROUPS.map((group) => (
                <tr key={group.label}>
                  <td className="px-4 py-3 font-medium text-ink">{group.label}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-ink-muted">{group.fields}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-info-400">{group.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DeepDiveSection>

      <DeepDiveSection icon={DatabaseZap} eyebrow="RETRIEVAL CONFIG" title="Embedding, chunking, fusion, and reranking">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Parameter label="Embedding" value="BAAI/bge-large-en-v1.5" note="normalized · BGE query prefix · CPU" />
          <Parameter label="Semantic chunks" value="220 tokens" note="30 overlap · p85 cosine break" />
          <Parameter label="Fallback chunks" value="1,200 chars" note="150-character overlap" />
          <Parameter label="Embedding batch" value="32 passages" note="lazy-loaded sentence-transformer" />
          <Parameter label="Candidate pool" value="50 dense + 50 BM25" note="parallel rankings across 4 corpora" />
          <Parameter label="Fusion" value="RRF k = 60" note="deduplication by stable chunk ID" />
          <Parameter label="Reranker" value="ms-marco MiniLM-L-6-v2" note="cross-encoder on fused top 50" />
          <Parameter label="Context budget" value="top 10 / pass" note="merge + dedup on critic repair" />
        </div>
        <div className="mt-4 rounded-lg border border-info-500/25 bg-info-500/5 p-4 text-xs leading-5 text-ink-muted">
          <strong className="text-info-400">Graceful degradation:</strong> an empty Chroma index skips the expensive dense model and lets BM25 carry the query;
          an unavailable cross-encoder returns fused ranks directly. Both paths are logged.
        </div>
      </DeepDiveSection>

      <DeepDiveSection icon={Gauge} eyebrow="RECORDED TRACE" title="Latency budget and bottleneck visibility">
        <div className="grid gap-6 lg:grid-cols-[1fr_310px]">
          <div className="space-y-3">
            {LATENCIES.map((item) => (
              <div key={item.label} className="grid grid-cols-[140px_1fr_70px] items-center gap-3 text-xs">
                <span className="text-ink-muted">{item.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-bg-subtle">
                  <div className={`h-full min-w-[3px] rounded-full ${item.tone}`} style={{ width: `${Math.min(item.pct, 100)}%` }} />
                </div>
                <span className="text-right font-mono text-ink">{item.ms}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-bg-card p-4">
            <div className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[.14em] text-brand-400"><Activity size={13} /> interpretation</div>
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              Generation dominates this recorded 13-transition repair trace. Retrieval is the second-largest budget. Fast deterministic tools remain visible,
              even when their bars round below one percent.
            </p>
            <p className="mt-2 font-mono text-[10px] leading-4 text-ink-dim">source: backend/data/exports/showcase_run.json · recorded, not a benchmark SLA</p>
          </div>
        </div>
      </DeepDiveSection>

      <DeepDiveSection icon={BrainCircuit} eyebrow="QUALITY + RECOVERY" title="Critique lifecycle and failure policy">
        <div className="grid gap-3 md:grid-cols-3">
          <PolicyCard number="01" title="Cross-family review" body="GPT-4o judges Gemini drafts when an OpenAI key is present; Gemini Flash is the configured fallback." />
          <PolicyCard number="02" title="Targeted repair" body="Failed rubric dimensions become critique_gaps. The next retrieval query expands with those gaps before the complete analysis chain reruns." />
          <PolicyCard number="03" title="Bounded + visible" body="The router stops after two critiques. Judge errors fail open to finalization but persist critique_error and the exact judge label in state." />
        </div>
      </DeepDiveSection>

      <DeepDiveSection icon={Boxes} eyebrow="ABLATION SURFACE" title="Components can be measured on the real graph">
        <div className="flex flex-wrap gap-2">
          {[
            ["disable_rag", "retrieval + citations"],
            ["disable_critique", "quality gate"],
            ["disable_comparables", "book similarity"],
            ["disable_xgb", "frequency model"],
          ].map(([flag, label]) => (
            <div key={flag} className="rounded-md border border-border bg-bg-card px-3 py-2">
              <code className="font-mono text-xs text-warn-400">{flag}</code>
              <span className="ml-2 text-xs text-ink-dim">{label}</span>
            </div>
          ))}
        </div>
      </DeepDiveSection>
    </div>
  );
}

function DeepDiveSection({
  icon: Icon,
  eyebrow,
  title,
  open = false,
  children,
}: {
  icon: typeof FileJson2;
  eyebrow: string;
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-b border-border last:border-b-0" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-bg-subtle/50 [&::-webkit-details-marker]:hidden">
        <span className="rounded-md border border-border bg-bg-card p-2 text-ink-muted"><Icon size={15} /></span>
        <span>
          <span className="block font-mono text-[10px] uppercase tracking-[.16em] text-ink-dim">{eyebrow}</span>
          <span className="mt-0.5 block text-sm font-semibold text-ink">{title}</span>
        </span>
        <ChevronDown size={16} className="ml-auto text-ink-dim transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border bg-bg/35 px-5 py-5">{children}</div>
    </details>
  );
}

function Parameter({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-[.14em] text-ink-dim">{label}</div>
      <div className="mt-2 break-words font-mono text-xs text-ink">{value}</div>
      <div className="mt-2 text-[11px] leading-4 text-ink-dim">{note}</div>
    </div>
  );
}

function PolicyCard({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4">
      <div className="font-mono text-2xs text-brand-400">{number}</div>
      <div className="mt-2 text-sm font-semibold">{title}</div>
      <p className="mt-2 text-xs leading-5 text-ink-dim">{body}</p>
    </div>
  );
}
