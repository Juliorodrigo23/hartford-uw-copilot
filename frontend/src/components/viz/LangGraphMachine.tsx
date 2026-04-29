"use client";

/**
 * LangGraphMachine — animated state-machine traversal of the 8-node UW graph.
 *
 * Visual contract:
 *  - Nodes glow when active, dim when idle, retain a "completed" tint when done.
 *  - Edges illuminate during transitions; a moving particle slides along the
 *    edge so the data flow is unambiguous.
 *  - Conditional self-critique loops are drawn explicitly so the cyclical
 *    reasoning is the headline, not buried.
 *  - Replay / pause / step / speed controls — interviewers love a scrubber.
 */

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  StepForward,
  Gauge,
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

type Node = {
  id: NodeId;
  label: string;
  pos: { x: number; y: number };
  kind: "input" | "tool" | "rag" | "ml" | "llm" | "router" | "terminal";
  ms?: number; // typical latency
};

const NODES: Node[] = [
  { id: "parse_submission", label: "Parse submission", pos: { x: 90, y: 70 }, kind: "input", ms: 220 },
  { id: "enrich_carrier", label: "Enrich · SAFER", pos: { x: 280, y: 70 }, kind: "tool", ms: 540 },
  { id: "retrieve_context", label: "Retrieve · Hybrid RAG", pos: { x: 470, y: 70 }, kind: "rag", ms: 380 },
  { id: "analyze_loss_history", label: "Loss history · XGB", pos: { x: 280, y: 200 }, kind: "ml", ms: 95 },
  { id: "find_comparables", label: "Comparable accounts", pos: { x: 470, y: 200 }, kind: "rag", ms: 130 },
  { id: "draft_memo", label: "Draft memo · Gemini 2.0", pos: { x: 660, y: 70 }, kind: "llm", ms: 4200 },
  { id: "self_critique", label: "Self-critique · rubric", pos: { x: 660, y: 200 }, kind: "router", ms: 1900 },
  { id: "finalize", label: "Finalize · structured", pos: { x: 850, y: 135 }, kind: "terminal", ms: 110 },
  { id: "data_insufficient", label: "Data insufficient", pos: { x: 280, y: 320 }, kind: "terminal", ms: 60 },
];

type Edge = { from: NodeId; to: NodeId; cond?: string };
const EDGES: Edge[] = [
  { from: "parse_submission", to: "enrich_carrier" },
  { from: "enrich_carrier", to: "retrieve_context", cond: "SAFER ok" },
  { from: "enrich_carrier", to: "data_insufficient", cond: "no DOT match" },
  { from: "retrieve_context", to: "analyze_loss_history" },
  { from: "analyze_loss_history", to: "find_comparables" },
  { from: "find_comparables", to: "draft_memo" },
  { from: "draft_memo", to: "self_critique" },
  { from: "self_critique", to: "retrieve_context", cond: "gap flagged · loop ≤ 2" },
  { from: "self_critique", to: "finalize", cond: "passes rubric" },
];

// Three replayable traces — pulled from real runs (frontend ships sample JSON).
type Trace = { name: string; description: string; steps: { node: NodeId; ms: number }[] };
const TRACES: Trace[] = [
  {
    name: "Clean fleet · single pass",
    description: "Mid-size dry-van fleet with clean SAFER record; rubric passes first try.",
    steps: [
      { node: "parse_submission", ms: 210 },
      { node: "enrich_carrier", ms: 520 },
      { node: "retrieve_context", ms: 360 },
      { node: "analyze_loss_history", ms: 95 },
      { node: "find_comparables", ms: 120 },
      { node: "draft_memo", ms: 4180 },
      { node: "self_critique", ms: 1820 },
      { node: "finalize", ms: 90 },
    ],
  },
  {
    name: "Critique loop · adverse SAFER",
    description: "High OOS rate triggers retrieval gap; critique routes back to fetch additional NTSB context.",
    steps: [
      { node: "parse_submission", ms: 200 },
      { node: "enrich_carrier", ms: 610 },
      { node: "retrieve_context", ms: 410 },
      { node: "analyze_loss_history", ms: 100 },
      { node: "find_comparables", ms: 130 },
      { node: "draft_memo", ms: 4500 },
      { node: "self_critique", ms: 2050 },
      { node: "retrieve_context", ms: 290 },
      { node: "draft_memo", ms: 3900 },
      { node: "self_critique", ms: 1700 },
      { node: "finalize", ms: 110 },
    ],
  },
  {
    name: "Edge case · DOT not found",
    description: "Submission references a DOT we can't resolve; agent short-circuits to data-insufficient.",
    steps: [
      { node: "parse_submission", ms: 230 },
      { node: "enrich_carrier", ms: 480 },
      { node: "data_insufficient", ms: 60 },
    ],
  },
];

const KIND_COLORS: Record<Node["kind"], { stroke: string; fill: string; text: string }> = {
  input: { stroke: "#60a5fa", fill: "rgba(96,165,250,0.10)", text: "#bfdbfe" },
  tool: { stroke: "#34d399", fill: "rgba(52,211,153,0.10)", text: "#a7f3d0" },
  rag: { stroke: "#c084fc", fill: "rgba(192,132,252,0.10)", text: "#e9d5ff" },
  ml: { stroke: "#fbbf24", fill: "rgba(251,191,36,0.10)", text: "#fde68a" },
  llm: { stroke: "#f87171", fill: "rgba(248,113,113,0.10)", text: "#fecaca" },
  router: { stroke: "#fb923c", fill: "rgba(251,146,60,0.10)", text: "#fed7aa" },
  terminal: { stroke: "#9ca3af", fill: "rgba(156,163,175,0.10)", text: "#e5e7eb" },
};

export function LangGraphMachine() {
  const [traceIdx, setTraceIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  // 1× = real wall-clock latency. Default 0.8× = a touch slower than real,
  // which gives you time to read each node label as it lights up.
  const [speed, setSpeed] = useState(0.8);
  const trace = TRACES[traceIdx];
  const total = trace.steps.length;
  const tickRef = useRef<number | null>(null);

  // Auto-step using the trace's per-step latency, scaled by speed.
  useEffect(() => {
    if (!playing) return;
    const cur = trace.steps[step];
    if (!cur) {
      // Trace finished — linger on the completed state long enough to read
      // before looping. 8 seconds feels like "this stayed loaded" without
      // becoming static.
      tickRef.current = window.setTimeout(() => setStep(0), 8000);
      return () => {
        if (tickRef.current) window.clearTimeout(tickRef.current);
      };
    }
    // Floor at 600ms so even fast nodes (e.g. xgb_loss_freq @ 28ms) hold long
    // enough to be readable. Cap at 8s so draft_memo doesn't drag the whole run.
    const ms = Math.min(8000, Math.max(600, cur.ms / speed));
    tickRef.current = window.setTimeout(() => setStep((s) => s + 1), ms);
    return () => {
      if (tickRef.current) window.clearTimeout(tickRef.current);
    };
  }, [step, playing, speed, trace]);

  const activeNode = trace.steps[step]?.node;
  const completed = useMemo(() => new Set(trace.steps.slice(0, step).map((s) => s.node)), [step, trace]);
  const fromTo = useMemo(() => {
    if (step <= 0) return null;
    const a = trace.steps[step - 1]?.node;
    const b = trace.steps[step]?.node;
    if (!a || !b) return null;
    return { a, b };
  }, [step, trace]);

  const nodeById = useMemo(() => new Map(NODES.map((n) => [n.id, n])), []);
  const cumulativeMs = trace.steps.slice(0, step).reduce((s, x) => s + x.ms, 0);

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-panel/60 p-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="btn-ghost"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            onClick={() => {
              setStep(0);
              setPlaying(true);
            }}
            className="btn-ghost"
            aria-label="Restart"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={() => setStep((s) => Math.min(s + 1, total))}
            className="btn-ghost"
            aria-label="Step"
          >
            <StepForward size={14} />
          </button>
        </div>

        <div className="ml-2 flex items-center gap-2 text-2xs text-ink-muted">
          <Gauge size={12} />
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer"
          />
          <span className="font-mono w-10 tabular-nums">{speed.toFixed(1)}×</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            className="rounded-md border border-border bg-bg-card px-2 py-1 text-xs text-ink"
            value={traceIdx}
            onChange={(e) => {
              setTraceIdx(Number(e.target.value));
              setStep(0);
              setPlaying(true);
            }}
          >
            {TRACES.map((t, i) => (
              <option key={t.name} value={i}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status strip */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-2xs text-ink-muted">
        <div className="flex items-center gap-2">
          <span className="font-mono uppercase tracking-[0.18em] text-ink-dim">trace</span>
          <span>{trace.description}</span>
        </div>
        <div className="font-mono tabular-nums">
          step {Math.min(step, total)}/{total} · {cumulativeMs.toLocaleString()} ms
        </div>
      </div>

      {/* Graph */}
      <div className="relative h-[420px] w-full bg-[radial-gradient(circle_at_30%_30%,rgba(220,38,38,0.06),transparent_60%)]">
        <svg
          viewBox="0 0 960 400"
          className="h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
            </marker>
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#f87171" />
            </marker>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Edges */}
          {EDGES.map((e) => {
            const a = nodeById.get(e.from)!;
            const b = nodeById.get(e.to)!;
            const isActive = !!fromTo && fromTo.a === e.from && fromTo.b === e.to;
            const path = curvedPath(a.pos.x, a.pos.y, b.pos.x, b.pos.y, e.from === "self_critique" && e.to === "retrieve_context");
            return (
              <g key={`${e.from}-${e.to}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={isActive ? "#f87171" : "#2b3645"}
                  strokeWidth={isActive ? 2.4 : 1.4}
                  strokeDasharray={e.cond ? "4 3" : undefined}
                  markerEnd={`url(#${isActive ? "arrow-active" : "arrow"})`}
                  filter={isActive ? "url(#glow)" : undefined}
                />
                {e.cond && (
                  <text
                    x={(a.pos.x + b.pos.x) / 2}
                    y={(a.pos.y + b.pos.y) / 2 - 6}
                    textAnchor="middle"
                    className="fill-ink-dim text-[10px] font-mono"
                  >
                    {e.cond}
                  </text>
                )}
                {isActive && (
                  <motion.circle
                    r="3"
                    fill="#fecaca"
                    initial={{ offsetDistance: "0%" }}
                    animate={{ offsetDistance: "100%" }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                    style={{ offsetPath: `path("${path}")` }}
                  />
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {NODES.map((n) => {
            const colors = KIND_COLORS[n.kind];
            const isActive = activeNode === n.id;
            const isDone = completed.has(n.id) && !isActive;
            return (
              <NodeBox
                key={n.id}
                node={n}
                colors={colors}
                isActive={isActive}
                isDone={isDone}
              />
            );
          })}
        </svg>

        {/* Active-node info card */}
        <AnimatePresence mode="wait">
          {activeNode && (
            <motion.div
              key={`${traceIdx}-${step}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="absolute bottom-3 left-1/2 w-[min(560px,90%)] -translate-x-1/2 rounded-lg border border-border bg-bg-card/95 px-4 py-2 backdrop-blur"
            >
              <div className="flex items-center justify-between">
                <div className="font-mono text-xs text-ink">
                  <span className="text-ink-dim">node →</span>{" "}
                  {nodeById.get(activeNode)?.label}
                </div>
                <div className="font-mono text-2xs text-ink-dim">
                  {(trace.steps[step]?.ms ?? 0).toLocaleString()} ms
                </div>
              </div>
              <div className="mt-1 text-2xs text-ink-muted">{NODE_BLURBS[activeNode]}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 text-2xs text-ink-muted">
        <Legend label="input" color="#60a5fa" />
        <Legend label="tool" color="#34d399" />
        <Legend label="rag" color="#c084fc" />
        <Legend label="ml" color="#fbbf24" />
        <Legend label="llm" color="#f87171" />
        <Legend label="router" color="#fb923c" />
        <Legend label="terminal" color="#9ca3af" />
      </div>
    </div>
  );
}

function NodeBox({
  node,
  colors,
  isActive,
  isDone,
}: {
  node: Node;
  colors: { stroke: string; fill: string; text: string };
  isActive: boolean;
  isDone: boolean;
}) {
  const w = 168;
  const h = 44;
  const x = node.pos.x - w / 2;
  const y = node.pos.y - h / 2;
  return (
    <g>
      <motion.rect
        x={x}
        y={y}
        rx={8}
        ry={8}
        width={w}
        height={h}
        fill={isActive ? colors.fill : isDone ? "rgba(255,255,255,0.02)" : "#10141b"}
        stroke={isActive ? colors.stroke : isDone ? "#374151" : "#1f2733"}
        strokeWidth={isActive ? 1.8 : 1}
        animate={
          isActive
            ? { filter: ["drop-shadow(0 0 0 transparent)", `drop-shadow(0 0 12px ${colors.stroke}cc)`, "drop-shadow(0 0 4px transparent)"] }
            : { filter: "drop-shadow(0 0 0 transparent)" }
        }
        transition={{ duration: 1.4, repeat: isActive ? Infinity : 0 }}
      />
      <text
        x={node.pos.x}
        y={node.pos.y - 2}
        textAnchor="middle"
        className={cn(
          "text-[12px] font-medium",
          isActive ? "" : isDone ? "fill-ink-muted" : "fill-ink"
        )}
        fill={isActive ? colors.text : undefined}
      >
        {node.label}
      </text>
      <text
        x={node.pos.x}
        y={node.pos.y + 12}
        textAnchor="middle"
        className="fill-ink-dim font-mono text-[9px]"
      >
        {node.id}
      </text>
    </g>
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      <span className="font-mono">{label}</span>
    </div>
  );
}

function curvedPath(x1: number, y1: number, x2: number, y2: number, loop = false): string {
  if (loop) {
    // Big upward loop for self_critique → retrieve_context
    const cx1 = x1 - 30;
    const cy1 = y1 + 110;
    const cx2 = x2 + 60;
    const cy2 = y2 + 140;
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx1 = x1 + dx * 0.4;
  const cy1 = y1 + dy * 0.05;
  const cx2 = x2 - dx * 0.4;
  const cy2 = y2 - dy * 0.05;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

const NODE_BLURBS: Record<NodeId, string> = {
  parse_submission:
    "Pulls structured fields out of the broker email + ACORD-style packet using a Pydantic-validated Gemini extraction call.",
  enrich_carrier:
    "Calls the FMCSA SAFER service for the DOT number on the submission. Returns crash count, OOS rate, fleet size, operating authority status.",
  retrieve_context:
    "Hybrid retrieval over Chroma (BM25 + dense + RRF), then cross-encoder rerank. Pulls NTSB narratives and 10-K risk-factor sections most similar to the carrier profile.",
  analyze_loss_history:
    "Computes frequency / severity / trend on the loss run, then calls the trained XGBoost loss-frequency model for an out-of-sample expected claim count.",
  find_comparables:
    "Vector search over the synthetic book-of-business for top-k similar accounts. Returns risk score distribution of comparables.",
  draft_memo:
    "Gemini 2.0 Pro generates the underwriting memo against a structured template, citing every claim with [n] inline references.",
  self_critique:
    "GPT-4o-or-Gemini-judge runs the memo against a 5-dimension rubric. If it flags a missing exposure, the agent loops back to retrieve_context (max 2x).",
  finalize: "Emits the final memo + structured RiskScore + producer summary as a Pydantic v2 model.",
  data_insufficient:
    "Short-circuit: SAFER didn't resolve the DOT. Agent bails out cleanly with a structured 'cannot triage' response so a human can intervene.",
};
