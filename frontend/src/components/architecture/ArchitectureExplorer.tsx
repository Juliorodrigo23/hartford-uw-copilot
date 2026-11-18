"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleStop,
  Database,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";

type NodeId =
  | "parse_submission"
  | "enrich_carrier"
  | "retrieve_context"
  | "analyze_loss_history"
  | "find_comparables"
  | "draft_memo"
  | "self_critique"
  | "finalize"
  | "data_insufficient";

type GraphNode = {
  id: NodeId;
  label: string;
  eyebrow: string;
  kind: "llm" | "tool" | "rag" | "ml" | "router" | "terminal";
  x: number;
  y: number;
  reads: string[];
  writes: string[];
  summary: string;
  implementation: string;
  latency: string;
};

const NODES: GraphNode[] = [
  {
    id: "parse_submission",
    label: "Parse submission",
    eyebrow: "ENTRY · LLM",
    kind: "llm",
    x: 100,
    y: 80,
    reads: ["submission_id", "user_message"],
    writes: ["submission", "parse_notes"],
    summary: "Loads a known packet by ID or extracts an ad-hoc packet into the strict Submission schema.",
    implementation: "Gemini 3.5 Flash Lite extraction → JSON parse → Pydantic validation. A missing DOT produces submission=None.",
    latency: "2 ms recorded (disk path)",
  },
  {
    id: "enrich_carrier",
    label: "Enrich carrier",
    eyebrow: "TOOL · SAFER",
    kind: "tool",
    x: 290,
    y: 80,
    reads: ["submission.dot_number", "tool_calls"],
    writes: ["safer_profile", "tool_calls", "tool_results", "data_insufficient_reason"],
    summary: "Resolves the submitted DOT against FMCSA SAFER and records the complete tool call.",
    implementation: "The after_enrich router checks safer_profile. A failed lookup short-circuits safely instead of fabricating risk evidence.",
    latency: "1 ms recorded (seeded cache)",
  },
  {
    id: "retrieve_context",
    label: "Retrieve evidence",
    eyebrow: "HYBRID RAG",
    kind: "rag",
    x: 480,
    y: 80,
    reads: ["submission", "safer_profile", "user_message", "critique_gaps", "retrieved"],
    writes: ["retrieved", "citations"],
    summary: "Runs dense and lexical search, fuses ranks, reranks evidence, and preserves citation identity.",
    implementation: "On a critic loop, gaps are appended to the query. New chunks merge with prior evidence and deduplicate by chunk ID.",
    latency: "10.37 s first pass · 2.33 s repair pass",
  },
  {
    id: "analyze_loss_history",
    label: "Model loss risk",
    eyebrow: "ACTUARIAL + ML",
    kind: "ml",
    x: 480,
    y: 205,
    reads: ["submission", "safer_profile", "disable_xgb"],
    writes: ["loss_stats", "xgb_pred", "tool_calls", "tool_results"],
    summary: "Computes frequency, severity, trend, and loss ratio before estimating next-year claims.",
    implementation: "The prediction includes an 80% interval, top SHAP effects, model version, and an explicit heuristic-fallback provenance flag.",
    latency: "155 ms recorded",
  },
  {
    id: "find_comparables",
    label: "Find comparables",
    eyebrow: "VECTOR TOOL",
    kind: "rag",
    x: 670,
    y: 205,
    reads: ["submission", "safer_profile", "loss_stats"],
    writes: ["comparables", "tool_calls", "tool_results"],
    summary: "Finds five similar accounts using the evidence gathered upstream—not placeholder medians.",
    implementation: "The node is independently switchable in ablation runs and records matched accounts and timing in the shared trace.",
    latency: "1 ms recorded",
  },
  {
    id: "draft_memo",
    label: "Draft memo",
    eyebrow: "GEMINI 3.8 FLASH",
    kind: "llm",
    x: 670,
    y: 80,
    reads: ["submission", "retrieved", "loss_stats", "xgb_pred", "comparables", "critique_gaps"],
    writes: ["memo_md", "draft_iters"],
    summary: "Generates the underwriting memo from structured evidence and an explicit citation contract.",
    implementation: "Repair drafts receive every prior critique gap. Missing evidence is labeled unknown; generation errors cannot become opinions.",
    latency: "36.30 s first draft · 35.76 s repair",
  },
  {
    id: "self_critique",
    label: "Critique & route",
    eyebrow: "CONDITIONAL EDGE",
    kind: "router",
    x: 860,
    y: 80,
    reads: ["memo_md", "safer_profile", "loss_stats", "xgb_pred", "citations", "critique_iters"],
    writes: ["critique_pass", "critique_iters", "critique_gaps", "rubric_scores", "critique_judge", "critique_error"],
    summary: "Grades the draft against grounded evidence and decides whether to repair or finalize.",
    implementation: "GPT-4o is used when configured, with Gemini fallback. The gate fails open visibly on judge failure and stops after two critiques.",
    latency: "1.70–1.74 s recorded",
  },
  {
    id: "finalize",
    label: "Finalize package",
    eyebrow: "TERMINAL",
    kind: "terminal",
    x: 860,
    y: 265,
    reads: ["submission", "memo_md", "citations", "rubric_scores"],
    writes: ["memo", "disposition"],
    summary: "Emits a typed decision package containing the memo, citations, producer summary, and disposition.",
    implementation: "A generation failure maps to data_insufficient at 0% confidence. The package stops at a human decision boundary—no policy is bound automatically.",
    latency: "1 ms recorded",
  },
  {
    id: "data_insufficient",
    label: "Human workup",
    eyebrow: "SAFE TERMINAL",
    kind: "terminal",
    x: 290,
    y: 355,
    reads: ["submission", "data_insufficient_reason"],
    writes: ["memo", "memo_md", "disposition"],
    summary: "Returns a structured cannot-triage package when carrier evidence cannot be resolved.",
    implementation: "The terminal explicitly routes the packet to a human underwriter for manual workup with confidence=1.0 in the insufficiency finding.",
    latency: "~60 ms representative",
  },
];

type GraphEdge = { from: NodeId; to: NodeId; label?: string; special?: "loop" | "branch" };

const EDGES: GraphEdge[] = [
  { from: "parse_submission", to: "enrich_carrier" },
  { from: "enrich_carrier", to: "retrieve_context", label: "safer_profile exists", special: "branch" },
  { from: "enrich_carrier", to: "data_insufficient", label: "no DOT match", special: "branch" },
  { from: "retrieve_context", to: "analyze_loss_history" },
  { from: "analyze_loss_history", to: "find_comparables" },
  { from: "find_comparables", to: "draft_memo" },
  { from: "draft_memo", to: "self_critique" },
  { from: "self_critique", to: "retrieve_context", label: "gaps · iter < 2", special: "loop" },
  { from: "self_critique", to: "finalize", label: "pass OR iter = 2", special: "branch" },
];

const RECORDED_TRACE: NodeId[] = [
  "parse_submission",
  "enrich_carrier",
  "retrieve_context",
  "analyze_loss_history",
  "find_comparables",
  "draft_memo",
  "self_critique",
  "retrieve_context",
  "analyze_loss_history",
  "find_comparables",
  "draft_memo",
  "self_critique",
  "finalize",
];

const NO_DOT_TRACE: NodeId[] = ["parse_submission", "enrich_carrier", "data_insufficient"];

const COLORS: Record<GraphNode["kind"], { stroke: string; fill: string; text: string }> = {
  llm: { stroke: "#f87171", fill: "rgba(248,113,113,.12)", text: "#fecaca" },
  tool: { stroke: "#34d399", fill: "rgba(52,211,153,.12)", text: "#a7f3d0" },
  rag: { stroke: "#c084fc", fill: "rgba(192,132,252,.12)", text: "#e9d5ff" },
  ml: { stroke: "#fbbf24", fill: "rgba(251,191,36,.12)", text: "#fde68a" },
  router: { stroke: "#fb923c", fill: "rgba(251,146,60,.12)", text: "#fed7aa" },
  terminal: { stroke: "#60a5fa", fill: "rgba(96,165,250,.12)", text: "#bfdbfe" },
};

export function ArchitectureExplorer() {
  const [traceKind, setTraceKind] = useState<"recorded" | "no-dot">("recorded");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<NodeId>("retrieve_context");
  const trace = traceKind === "recorded" ? RECORDED_TRACE : NO_DOT_TRACE;
  const active = trace[Math.min(step, trace.length - 1)];
  const selected = NODES.find((node) => node.id === selectedId)!;
  const completed = useMemo(() => new Set(trace.slice(0, step)), [step, trace]);

  useEffect(() => {
    if (!playing) return;
    if (step >= trace.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setStep((value) => value + 1), 1050);
    return () => window.clearTimeout(timer);
  }, [playing, step, trace.length]);

  useEffect(() => {
    setSelectedId(active);
  }, [active]);

  function reset(nextKind = traceKind) {
    setTraceKind(nextKind);
    setStep(0);
    setPlaying(false);
  }

  const activeEdge = step > 0 ? { from: trace[step - 1], to: trace[step] } : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-xl shadow-black/10">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-panel/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {playing && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-400" />
          </span>
          <span className="font-mono text-2xs uppercase tracking-[0.16em] text-ink-muted">graph replay</span>
        </div>

        <select
          aria-label="Select replay path"
          value={traceKind}
          onChange={(event) => reset(event.target.value as "recorded" | "no-dot")}
          className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-border-strong"
        >
          <option value="recorded">SUB-001 · recorded critic repair</option>
          <option value="no-dot">Missing DOT · safety branch</option>
        </select>

        <div className="flex items-center gap-1">
          <button className="btn-ghost h-8 px-2" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause replay" : "Play replay"}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button className="btn-ghost h-8 px-2" onClick={() => reset()} aria-label="Reset replay"><RotateCcw size={14} /></button>
        </div>

        <div className="ml-auto flex items-center gap-3 font-mono text-2xs text-ink-dim">
          <span>step {step + 1}/{trace.length}</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-subtle">
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${((step + 1) / trace.length) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="border-b border-border bg-[radial-gradient(circle_at_52%_30%,rgba(220,38,38,.07),transparent_38%)] p-3 md:p-5">
        <div className="overflow-x-auto">
          <svg viewBox="0 0 960 430" className="h-auto min-w-[900px] w-full" role="img" aria-label="Interactive LangGraph underwriting state machine">
            <defs>
              <marker id="architecture-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
              </marker>
              <marker id="architecture-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f87171" />
              </marker>
              <filter id="architecture-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>

            <rect x="745" y="222" width="220" height="175" rx="14" fill="rgba(96,165,250,.035)" stroke="rgba(96,165,250,.3)" strokeDasharray="5 5" />
            <text x="855" y="385" textAnchor="middle" className="fill-info-400 font-mono text-[9px] tracking-[.14em]">HUMAN DECISION BOUNDARY</text>
            <rect x="175" y="315" width="230" height="82" rx="14" fill="rgba(96,165,250,.025)" stroke="rgba(96,165,250,.22)" strokeDasharray="5 5" />

            {EDGES.map((edge) => {
              const from = NODES.find((node) => node.id === edge.from)!;
              const to = NODES.find((node) => node.id === edge.to)!;
              const isActive = activeEdge?.from === edge.from && activeEdge.to === edge.to;
              const path = edgePath(from, to, edge.special);
              const label = edgeLabelPosition(from, to, edge.special);
              return (
                <g key={`${edge.from}-${edge.to}`}>
                  <path
                    d={path}
                    fill="none"
                    stroke={isActive ? "#f87171" : edge.special === "branch" ? "#3b485a" : "#2b3645"}
                    strokeWidth={isActive ? 2.4 : 1.35}
                    strokeDasharray={edge.special ? "5 4" : undefined}
                    markerEnd={`url(#${isActive ? "architecture-arrow-active" : "architecture-arrow"})`}
                    filter={isActive ? "url(#architecture-glow)" : undefined}
                  />
                  {edge.label && (
                    <g>
                      <rect x={label.x - label.width / 2} y={label.y - 11} width={label.width} height="17" rx="8" fill="#0a0d12" stroke="#1f2733" />
                      <text x={label.x} y={label.y + 1} textAnchor="middle" className="fill-ink-dim font-mono text-[8.5px]">{edge.label}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {NODES.map((node) => {
              const colors = COLORS[node.kind];
              const isActive = active === node.id;
              const isSelected = selectedId === node.id;
              const isDone = completed.has(node.id);
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer outline-none"
                  aria-label={`Inspect ${node.label}`}
                  onClick={() => setSelectedId(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedId(node.id);
                  }}
                >
                  <rect
                    x={node.x - 76}
                    y={node.y - 31}
                    width="152"
                    height="62"
                    rx="10"
                    fill={isActive || isSelected ? colors.fill : "#10141b"}
                    stroke={isActive ? colors.stroke : isSelected ? `${colors.stroke}aa` : isDone ? "#405064" : "#263140"}
                    strokeWidth={isActive ? 2 : isSelected ? 1.6 : 1}
                    filter={isActive ? "url(#architecture-glow)" : undefined}
                  />
                  {isDone && !isActive && <circle cx={node.x + 61} cy={node.y - 17} r="7" fill="#10b981" />}
                  {isDone && !isActive && <path d={`M ${node.x + 57} ${node.y - 17} l3 3 l5 -6`} fill="none" stroke="#07110d" strokeWidth="1.8" />}
                  <text x={node.x} y={node.y - 7} textAnchor="middle" fill={isActive || isSelected ? colors.text : "#e6ebf2"} className="text-[11.5px] font-medium">{node.label}</text>
                  <text x={node.x} y={node.y + 10} textAnchor="middle" fill={colors.stroke} className="font-mono text-[8px] tracking-[.12em]">{node.eyebrow}</text>
                  <text x={node.x} y={node.y + 23} textAnchor="middle" className="fill-ink-dim font-mono text-[7px]">{node.id}</text>
                </g>
              );
            })}

            <g transform="translate(20 414)">
              <circle cx="5" cy="-2" r="4" fill="#60a5fa" />
              <text x="15" y="1" className="fill-ink-dim font-mono text-[8px]">checkpoint persisted after each completed transition</text>
            </g>
          </svg>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.1fr_.9fr]">
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-2xs uppercase tracking-[0.16em]" style={{ color: COLORS[selected.kind].stroke }}>{selected.eyebrow}</div>
              <h3 className="mt-1 text-lg font-semibold">{selected.label}</h3>
            </div>
            <span className="rounded-md border border-border bg-bg-panel px-2.5 py-1 font-mono text-2xs text-ink-muted">{selected.latency}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink-muted">{selected.summary}</p>
          <p className="mt-2 text-xs leading-5 text-ink-dim">{selected.implementation}</p>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-1 lg:divide-x-0 lg:divide-y xl:grid-cols-2 xl:divide-x xl:divide-y-0">
          <StateList label="reads from state" values={selected.reads} tone="text-info-400" />
          <StateList label="writes state patch" values={selected.writes} tone="text-accent-400" />
        </div>
      </div>
    </div>
  );
}

function StateList({ label, values, tone }: { label: string; values: string[]; tone: string }) {
  return (
    <div className="p-5">
      <div className={cn("font-mono text-2xs uppercase tracking-[0.16em]", tone)}>{label}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {values.map((value) => <code key={value} className="rounded border border-border bg-bg px-1.5 py-1 font-mono text-[10px] text-ink-muted">{value}</code>)}
      </div>
    </div>
  );
}

function edgePath(from: GraphNode, to: GraphNode, special?: GraphEdge["special"]) {
  if (special === "loop") return `M ${from.x - 76} ${from.y - 5} C ${from.x - 110} -5, ${to.x + 80} -5, ${to.x + 25} ${to.y - 31}`;
  if (from.id === "enrich_carrier" && to.id === "data_insufficient") return `M ${from.x} ${from.y + 31} C ${from.x} 180, ${to.x} 250, ${to.x} ${to.y - 31}`;
  if (from.id === "self_critique" && to.id === "finalize") return `M ${from.x} ${from.y + 31} C ${from.x} 150, ${to.x} 195, ${to.x} ${to.y - 31}`;
  if (from.y === to.y) return `M ${from.x + 76} ${from.y} L ${to.x - 76} ${to.y}`;
  if (from.id === "retrieve_context") return `M ${from.x} ${from.y + 31} L ${to.x} ${to.y - 31}`;
  if (from.id === "find_comparables") return `M ${from.x} ${from.y - 31} L ${to.x} ${to.y + 31}`;
  return `M ${from.x + 76} ${from.y} L ${to.x - 76} ${to.y}`;
}

function edgeLabelPosition(from: GraphNode, to: GraphNode, special?: GraphEdge["special"]) {
  const textWidth = special === "loop" ? 102 : 104;
  if (special === "loop") return { x: 665, y: 12, width: textWidth };
  if (from.id === "enrich_carrier" && to.id === "data_insufficient") return { x: 345, y: 258, width: 82 };
  if (from.id === "self_critique") return { x: 913, y: 170, width: 100 };
  return { x: (from.x + to.x) / 2, y: from.y - 11, width: textWidth };
}

export function RagLifecycle() {
  const stages = [
    { id: "01", label: "Semantic chunk", value: "220 tokens", detail: "30-token overlap · 85th-percentile sentence-distance breakpoints", tone: "text-info-400 border-info-500/30" },
    { id: "02", label: "Parallel retrieve", value: "50 + 50", detail: "BGE-large dense candidates + BM25 lexical candidates", tone: "text-accent-400 border-accent-500/30" },
    { id: "03", label: "Fuse identity", value: "RRF k=60", detail: "chunk-ID deduplication keeps ranks and citations aligned", tone: "text-warn-400 border-warn-500/30" },
    { id: "04", label: "Cross-encode", value: "top 50 → 10", detail: "ms-marco MiniLM scores query–passage pairs", tone: "text-brand-400 border-brand-500/30" },
    { id: "05", label: "Critique repair", value: "≤ 2 passes", detail: "gaps expand the query; evidence merges without duplicate chunks", tone: "text-info-400 border-info-500/30" },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-5">
      {stages.map((stage, index) => (
        <div key={stage.id} className={cn("relative rounded-lg border bg-bg-card p-4", stage.tone)}>
          {index < stages.length - 1 && <ChevronRight className="absolute -right-[18px] top-1/2 z-10 hidden -translate-y-1/2 text-ink-dim md:block" size={18} />}
          <div className="font-mono text-2xs opacity-80">{stage.id}</div>
          <div className="mt-3 text-sm font-semibold text-ink">{stage.label}</div>
          <div className="mt-1 font-mono text-xs">{stage.value}</div>
          <p className="mt-3 text-[11px] leading-5 text-ink-dim">{stage.detail}</p>
        </div>
      ))}
    </div>
  );
}

export function HitlTruthCard() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TruthItem icon={Database} title="Durable checkpointing" status="implemented" statusTone="text-accent-400" detail="Async SQLite checkpoints are compiled into the production graph, so state survives requests and traces are replayable." />
      <TruthItem icon={ShieldAlert} title="Human decision boundary" status="implemented" statusTone="text-accent-400" detail="Insufficient data routes to manual workup; finalized recommendations remain decision support and never bind a policy." />
      <TruthItem icon={CircleStop} title="Native graph interrupt" status="not configured" statusTone="text-warn-400" detail="There is no LangGraph interrupt() or interrupt_before hook today. The UI names this gap instead of presenting checkpointing as approval." />
    </div>
  );
}

function TruthItem({ icon: Icon, title, status, statusTone, detail }: { icon: typeof Database; title: string; status: string; statusTone: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <Icon size={16} className={statusTone} />
        <span className={cn("font-mono text-[10px] uppercase tracking-[.12em]", statusTone)}>{status}</span>
      </div>
      <div className="mt-3 text-sm font-semibold">{title}</div>
      <p className="mt-2 text-xs leading-5 text-ink-dim">{detail}</p>
    </div>
  );
}
