"use client";

/**
 * AgentTracePanel — live mini-LangGraph that lights up as SSE events arrive.
 * Matches the LangGraphMachine layout but is more compact and event-driven
 * rather than self-stepping.
 */

import { motion } from "framer-motion";
import { Cpu, ChevronRight, Scale } from "lucide-react";

const NODES = [
  "parse_submission",
  "enrich_carrier",
  "retrieve_context",
  "analyze_loss_history",
  "find_comparables",
  "draft_memo",
  "self_critique",
  "finalize",
] as const;

export type TraceEvent =
  | { kind: "node_enter"; node: string; t_ms: number }
  | { kind: "node_exit"; node: string; t_ms: number }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; name: string; output: unknown; ms: number }
  | { kind: "citation"; ref: string; doc_id: string; snippet: string }
  | { kind: "critique_judge"; judge: string; iter: number; passed?: boolean; error?: string | null; gaps?: string[] };

export function AgentTracePanel({
  events,
  active,
  recorded = false,
}: {
  events: TraceEvent[];
  active: string | null;
  recorded?: boolean;
}) {
  const enteredAt = new Map<string, number>();
  const exitedAt = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "node_enter") enteredAt.set(e.node, e.t_ms);
    if (e.kind === "node_exit") exitedAt.set(e.node, e.t_ms);
  }

  const tools = events.filter((e): e is Extract<TraceEvent, { kind: "tool_call" | "tool_result" }> => e.kind === "tool_call" || e.kind === "tool_result");
  const citations = events.filter((e): e is Extract<TraceEvent, { kind: "citation" }> => e.kind === "citation");
  const judges = events.filter((e): e is Extract<TraceEvent, { kind: "critique_judge" }> => e.kind === "critique_judge");
  const lastJudge = judges[judges.length - 1];

  return (
    <div className="card flex h-full flex-col p-3">
      <div className="mb-2 flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
        <Cpu size={12} /> {recorded ? "recorded trace replay" : "live agent trace"}
      </div>

      {lastJudge && (
        <div
          className={`mb-2 flex flex-col gap-1 rounded-md border px-2 py-1.5 text-2xs ${
            lastJudge.error
              ? "border-warn-500/40 bg-warn-500/10 text-warn-400"
              : lastJudge.judge.startsWith("gpt")
              ? "border-info-500/40 bg-info-500/10 text-info-400"
              : "border-accent-500/40 bg-accent-500/10 text-accent-400"
          }`}
        >
          <span className="flex items-center gap-2 font-mono">
            <Scale size={11} />
            critique: {lastJudge.judge}
            {judges.length > 1 ? ` · iter ${lastJudge.iter}` : ""}
            {lastJudge.passed === false && " · flagged gaps → redrafting"}
            {!lastJudge.error && lastJudge.judge.startsWith("gpt") && " · cross-family"}
          </span>
          {lastJudge.error && (
            <span className="font-mono">
              ⚠ judge unavailable — this memo was NOT quality-checked ({lastJudge.error})
            </span>
          )}
          {!lastJudge.error && (lastJudge.gaps?.length ?? 0) > 0 && (
            <span className="text-2xs opacity-90">gaps: {lastJudge.gaps!.join("; ")}</span>
          )}
        </div>
      )}

      <ol className="space-y-1.5">
        {NODES.map((n) => {
          const entered = enteredAt.has(n);
          const exited = exitedAt.has(n);
          const ms = exited ? (exitedAt.get(n)! - (enteredAt.get(n) ?? 0)) : 0;
          const isActive = active === n;
          return (
            <motion.li
              key={n}
              animate={{
                borderColor: isActive ? "#f87171" : exited ? "#34d39955" : entered ? "#60a5fa" : "#1f2733",
              }}
              className="flex items-center justify-between rounded-md border bg-bg-card/60 px-3 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive
                      ? "animate-pulse bg-brand-400"
                      : exited
                      ? "bg-accent-400"
                      : entered
                      ? "bg-info-400"
                      : "bg-ink-dim"
                  }`}
                />
                <span className={exited ? "text-ink-muted" : "text-ink"}>{n}</span>
              </div>
              <span className="font-mono text-2xs tabular-nums text-ink-dim">
                {exited ? `${ms} ms` : isActive ? "…" : ""}
              </span>
            </motion.li>
          );
        })}
      </ol>

      {tools.length > 0 && (
        <>
          <div className="mb-1 mt-4 font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            tool calls
          </div>
          <div className="space-y-1.5">
            {dedupeToolPairs(tools).map((t, i) => (
              <div key={i} className="rounded-md border border-border bg-bg-card/60 p-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1 font-mono">
                    <span className="text-accent-400">{t.name}</span>
                    <ChevronRight size={11} className="text-ink-dim" />
                    <span className="text-ink-muted">{t.done ? "ok" : "running"}</span>
                  </div>
                  <span className="font-mono text-2xs text-ink-dim tabular-nums">{t.ms ? `${t.ms} ms` : "…"}</span>
                </div>
                {t.output != null && (
                  <details className="mt-1 text-2xs text-ink-muted">
                    <summary className="cursor-pointer font-mono text-ink-dim">output</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-bg-subtle/50 p-2 font-mono">
                      {JSON.stringify(t.output, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {citations.length > 0 && (
        <>
          <div className="mb-1 mt-4 font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            citations
          </div>
          <div className="space-y-1">
            {citations.map((c, i) => (
              <div key={c.ref + i} className="rounded-md border border-border bg-bg-card/60 px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-info-400">{c.ref}</span>
                  <span className="font-mono text-2xs text-ink-dim">{c.doc_id}</span>
                </div>
                <div className="mt-0.5 truncate text-ink-muted">{c.snippet}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function dedupeToolPairs(events: Extract<TraceEvent, { kind: "tool_call" | "tool_result" }>[]) {
  const map = new Map<string, { name: string; input?: unknown; output?: unknown; ms?: number; done: boolean }>();
  for (const e of events) {
    const m = map.get(e.id) ?? { name: e.name, done: false };
    if (e.kind === "tool_call") {
      m.input = e.input;
    } else {
      m.output = e.output;
      m.ms = e.ms;
      m.done = true;
    }
    map.set(e.id, m);
  }
  return Array.from(map.values());
}
