"use client";

/**
 * ToolCallStream — animated tool I/O from a single triage.
 *
 * Data source, in order of preference:
 *   1. showcase_run.json — a REAL captured end-to-end run
 *      (scripts/09_capture_showcase.py); badge shows "live pipeline data".
 *   2. Hardcoded example shapes, clearly badged illustrative, until a
 *      showcase run has been captured.
 */

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Wrench, ChevronRight } from "lucide-react";
import { DataBadge } from "@/components/DataBadge";
import { useAnimationGate } from "@/lib/useInView";
import { useData } from "@/lib/useData";
import type { ShowcaseRun } from "@/lib/api";

type Call = {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  ms: number;
};

const EXAMPLE_CALLS: Call[] = [
  {
    name: "safer_lookup",
    ms: 540,
    input: { dot_number: "0000000 (example)" },
    output: {
      legal_name: "EXAMPLE CARRIER (ILLUSTRATIVE)",
      operating_status: "AUTHORIZED FOR HIRE",
      power_units: 214,
      drivers: 247,
      crashes_24mo: { total: 18, fatal: 1, injury: 11, towaway: 6 },
      oos_rate: { vehicle: 0.27, driver: 0.052 },
    },
  },
  {
    name: "loss_calc",
    ms: 95,
    input: { loss_run: "5-yr loss run" },
    output: {
      frequency_per_pu_per_yr: 0.044,
      severity_avg_usd: 89_362,
      trend_3yr_pct: 14.7,
      loss_ratio_3yr: 0.71,
    },
  },
  {
    name: "xgb_loss_freq",
    ms: 28,
    input: { submission_id: "SUB-XXX" },
    output: {
      pred_claims_next_yr: 12.8,
      pi_80: [9.2, 16.7],
      shap_top: [
        { f: "oos_vehicle", v: 1.42 },
        { f: "fleet_size_log", v: 0.31 },
      ],
    },
  },
];

export function ToolCallStream() {
  const { data: showcase, status } = useData<ShowcaseRun>("showcase_run.json");
  const [step, setStep] = useState(0);
  const { ref: gateRef, active: gateActive, reduced } = useAnimationGate<HTMLDivElement>(0.3);

  const { calls, live } = useMemo(() => {
    if (status === "live" && showcase?.tool_calls?.length) {
      return {
        live: true,
        calls: showcase.tool_calls.map((t) => ({
          name: t.name,
          input: t.input,
          output: t.output,
          ms: t.ms ?? 0,
        })) as Call[],
      };
    }
    return { live: false, calls: EXAMPLE_CALLS };
  }, [showcase, status]);

  // 3.5s per tool card (there's JSON to read), 10s linger before looping,
  // only while visible.
  useEffect(() => {
    if (reduced) {
      setStep(calls.length);
      return;
    }
    if (!gateActive) return;
    if (step >= calls.length) {
      const t = setTimeout(() => setStep(0), 10000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), 3500);
    return () => clearTimeout(t);
  }, [step, gateActive, reduced, calls.length]);

  return (
    <div ref={gateRef} className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
        <Wrench size={12} /> tool calls ·{" "}
        {live ? `captured run ${showcase!.run_id} · ${showcase!.submission.id}` : "example triage run"}
        {live ? (
          <DataBadge kind="live" note={`verified run · ${showcase!.generated_at.slice(0, 10)}`} />
        ) : (
          <DataBadge
            kind="illustrative"
            note="example I/O shapes — run scripts/09_capture_showcase.py to replace with a real captured run"
          />
        )}
      </div>
      <div className="space-y-3">
        <AnimatePresence>
          {calls.slice(0, step).map((c, i) => (
            <motion.div
              key={c.name + i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="card border-border bg-bg-subtle/40 p-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-accent-500/10 px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.18em] text-accent-400">
                    tool
                  </span>
                  <span className="font-mono text-sm text-ink">{c.name}</span>
                </div>
                <span className="font-mono text-2xs text-ink-dim tabular-nums">{c.ms.toLocaleString()} ms</span>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">input</div>
                  <pre className="mt-1 overflow-x-auto rounded bg-bg-card/80 p-2 font-mono text-2xs text-ink">
                    {JSON.stringify(c.input, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="flex items-center gap-1 font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
                    output <ChevronRight size={10} />
                  </div>
                  <pre className="mt-1 max-h-56 overflow-auto rounded bg-bg-card/80 p-2 font-mono text-2xs text-ink">
                    {JSON.stringify(c.output, null, 2)}
                  </pre>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
