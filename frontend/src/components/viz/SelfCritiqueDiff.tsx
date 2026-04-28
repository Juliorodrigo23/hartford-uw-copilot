"use client";

/**
 * SelfCritiqueDiff — shows the memo before and after the self-critique loop.
 * Diffs are highlighted inline; the rubric scores update. The narrative is
 * "the agent caught its own omission of the BASIC HoS violation".
 */

import { motion } from "framer-motion";
import { useState } from "react";
import { ArrowRight, Check, AlertTriangle } from "lucide-react";

const V1 = `## Underwriting memo · DOT 2839412 · ABC Transport Inc

**Recommendation:** Quote with surcharge.

ABC Transport operates 214 power units in the south-central region with general freight commodity mix. Recent loss runs show 47 claims over 5 years with a $4.2M incurred total. The 3-year trend is increasing at ~14.7%/yr. The synthesized book of comparables shows similar carriers with adverse loss ratios.

**Risk drivers:** vehicle maintenance OOS rate (27%), elevated crash frequency relative to comparables.`;

const V2 = `## Underwriting memo · DOT 2839412 · ABC Transport Inc

**Recommendation:** Decline OR quote with significant surcharge + pre-binding loss control inspection.

ABC Transport operates 214 power units in the south-central region with general freight commodity mix. Recent loss runs show 47 claims over 5 years with a $4.2M incurred total. The 3-year trend is increasing at ~14.7%/yr. The synthesized book of comparables shows similar carriers with adverse loss ratios.

**Risk drivers:** vehicle maintenance OOS rate at 27% (industry median 12%), HoS Compliance BASIC score above the FMCSA federal-intervention threshold [NTSB 2020-08]; XGBoost predicts 12.8 claims next year (80% PI: 9.2–16.7).`;

const RUBRIC = [
  { dim: "Factual accuracy", before: 4.0, after: 4.6 },
  { dim: "Completeness", before: 2.6, after: 4.4 },
  { dim: "Calibration of risk language", before: 3.1, after: 4.5 },
  { dim: "Citation discipline", before: 1.5, after: 4.2 },
  { dim: "Format adherence", before: 4.4, after: 4.6 },
];

export function SelfCritiqueDiff() {
  const [phase, setPhase] = useState<"before" | "after">("before");

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          self-critique loop · iteration {phase === "before" ? 1 : 2}
        </div>
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
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="card bg-bg-subtle/40 p-4 font-mono text-xs leading-relaxed text-ink">
          <pre className="whitespace-pre-wrap">{phase === "before" ? V1 : V2}</pre>
        </div>
        <div className="card p-3">
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            rubric (judge: GPT-4o)
          </div>
          <ul className="mt-2 space-y-2">
            {RUBRIC.map((r) => {
              const v = phase === "before" ? r.before : r.after;
              return (
                <li key={r.dim}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">{r.dim}</span>
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
            {phase === "before" ? (
              <span className="flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn-400" />
                Critic flags: missing BASIC HoS context, no XGBoost interval cited,
                "surcharge" too soft given OOS rate.
              </span>
            ) : (
              <span className="flex items-start gap-1">
                <Check size={12} className="mt-0.5 shrink-0 text-accent-400" />
                Loop terminates: rubric ≥ 4.0 on every dimension. Memo finalized.
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-2xs text-ink-dim">
            <span>iter 1</span>
            <ArrowRight size={12} />
            <span>iter 2</span>
            <span className="text-ink-muted">avg {(RUBRIC.reduce((s, r) => s + r.after, 0) / RUBRIC.length).toFixed(1)}/5</span>
          </div>
        </div>
      </div>
    </div>
  );
}
