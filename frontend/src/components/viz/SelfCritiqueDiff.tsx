"use client";

/**
 * SelfCritiqueDiff — the memo before and after the self-critique loop.
 *
 * Data source, in order of preference:
 *   1. showcase_run.json (scripts/09_capture_showcase.py): REAL drafts and
 *      REAL judge verdicts from a captured end-to-end run. If the run had
 *      two drafts, the before/after toggle diffs them; if the first draft
 *      passed review, that verdict is shown as-is.
 *   2. A hardcoded worked example, badged illustrative, until a showcase
 *      run exists.
 */

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { DataBadge } from "@/components/DataBadge";
import { ArrowRight, Check, AlertTriangle } from "lucide-react";
import { useData } from "@/lib/useData";
import type { ShowcaseRun } from "@/lib/api";

const EXAMPLE_V1 = `## Underwriting memo · (illustrative example)

**Recommendation:** Quote with surcharge.

The carrier operates 214 power units with a general-freight commodity mix. Recent loss runs show 47 claims over 5 years with a $4.2M incurred total; the 3-year trend is increasing at ~14.7%/yr.

**Risk drivers:** vehicle maintenance OOS rate (27%), elevated crash frequency relative to comparables.`;

const EXAMPLE_V2 = `## Underwriting memo · (illustrative example)

**Recommendation:** Decline OR quote with significant surcharge + pre-binding loss control inspection.

The carrier operates 214 power units with a general-freight commodity mix. Recent loss runs show 47 claims over 5 years with a $4.2M incurred total; the 3-year trend is increasing at ~14.7%/yr.

**Risk drivers:** vehicle maintenance OOS rate at 27% (industry median 12%), HoS Compliance BASIC above the FMCSA intervention threshold [2]; the loss-frequency model predicts 12.8 claims next year (80% PI: 9.2–16.7).`;

const EXAMPLE_RUBRIC: Record<string, [number, number]> = {
  "factual_accuracy": [4.0, 4.6],
  "completeness": [2.6, 4.4],
  "calibration": [3.1, 4.5],
  "citations": [1.5, 4.2],
  "format": [4.4, 4.6],
};

export function SelfCritiqueDiff() {
  const { data: showcase, status } = useData<ShowcaseRun>("showcase_run.json");
  const [phase, setPhase] = useState<"before" | "after">("before");

  const view = useMemo(() => {
    if (status === "live" && showcase?.drafts?.length && showcase?.critiques?.length) {
      const drafts = showcase.drafts;
      const critiques = showcase.critiques;
      const looped = drafts.length >= 2;
      const first = critiques[0];
      const last = critiques[critiques.length - 1];
      const dims = Object.keys(first.rubric_scores ?? {});
      return {
        live: true as const,
        looped,
        judge: last.judge,
        before: drafts[0],
        after: drafts[drafts.length - 1],
        gaps: first.gaps ?? [],
        rubric: dims.map((d) => ({
          dim: d.replace(/_/g, " "),
          before: first.rubric_scores?.[d] ?? 0,
          after: last.rubric_scores?.[d] ?? first.rubric_scores?.[d] ?? 0,
        })),
        meta: showcase,
      };
    }
    return {
      live: false as const,
      looped: true,
      judge: "GPT-4o (example)",
      before: EXAMPLE_V1,
      after: EXAMPLE_V2,
      gaps: ["missing BASIC HoS context", "no model interval cited", '"surcharge" too soft given OOS rate'],
      rubric: Object.entries(EXAMPLE_RUBRIC).map(([d, [b, a]]) => ({
        dim: d.replace(/_/g, " "),
        before: b,
        after: a,
      })),
      meta: null,
    };
  }, [showcase, status]);

  const showAfter = phase === "after" && view.looped;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          self-critique loop{view.live && view.meta ? ` · captured run ${view.meta.run_id}` : ""}
        </div>
        {view.live ? (
          <DataBadge
            kind="live"
            note={view.looped ? "real drafts + real judge verdicts" : "real judge verdict · first draft passed review"}
          />
        ) : (
          <DataBadge
            kind="illustrative"
            note="worked example — run scripts/09_capture_showcase.py to replace with a real captured run"
          />
        )}
        {view.looped && (
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-bg-card p-1 text-xs">
            <button
              onClick={() => setPhase("before")}
              className={`rounded px-2 py-1 ${phase === "before" ? "bg-bg-subtle text-ink" : "text-ink-muted"}`}
            >
              before
            </button>
            <button
              onClick={() => setPhase("after")}
              className={`rounded px-2 py-1 ${phase === "after" ? "bg-bg-subtle text-ink" : "text-ink-muted"}`}
            >
              after critique
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="card max-h-96 overflow-y-auto bg-bg-subtle/40 p-4 font-mono text-xs leading-relaxed text-ink">
          <pre className="whitespace-pre-wrap">{showAfter ? view.after : view.before}</pre>
        </div>
        <div className="card p-3">
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            rubric (judge: {view.judge})
          </div>
          <ul className="mt-2 space-y-2">
            {view.rubric.map((r) => {
              const v = showAfter ? r.after : r.before;
              return (
                <li key={r.dim}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="capitalize text-ink-muted">{r.dim}</span>
                    <span className="font-mono tabular-nums text-ink">{v.toFixed(1)} / 5</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                    <motion.div
                      className="h-full bg-gradient-to-r from-brand-600 to-accent-500"
                      animate={{ width: `${(v / 5) * 100}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 border-t border-border pt-3 text-2xs text-ink-dim">
            {!showAfter && view.gaps.length > 0 ? (
              <span className="flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn-400" />
                Critic flags: {view.gaps.join("; ")}.
              </span>
            ) : (
              <span className="flex items-start gap-1">
                <Check size={12} className="mt-0.5 shrink-0 text-accent-400" />
                {view.looped
                  ? "Loop terminates: rubric passes. Memo finalized."
                  : "First draft passed the rubric review; no redraft was needed."}
              </span>
            )}
          </div>
          {view.looped && (
            <div className="mt-3 flex items-center justify-between text-2xs text-ink-dim">
              <span>iter 1</span>
              <ArrowRight size={12} />
              <span>iter 2</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
