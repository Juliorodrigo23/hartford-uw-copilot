"use client";

/**
 * ToolCallStream — animated tool I/O. Three tool calls fired by the agent
 * during a single triage. Each card streams its input then its result.
 */

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Wrench, ChevronRight } from "lucide-react";

type Call = {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  ms: number;
};

const CALLS: Call[] = [
  {
    name: "safer_lookup",
    ms: 540,
    input: { dot_number: "2839412" },
    output: {
      legal_name: "ABC TRANSPORT INC",
      operating_status: "AUTHORIZED FOR HIRE",
      power_units: 214,
      drivers: 247,
      crashes_24mo: { total: 18, fatal: 1, injury: 11, towaway: 6 },
      oos_rate: { vehicle: 0.27, driver: 0.052, hazmat: 0.0 },
      basic_violations: { hos: "above_threshold", driver_fitness: "below", vehicle_maint: "above" },
    },
  },
  {
    name: "loss_calc",
    ms: 95,
    input: { loss_run: "5-yr loss run · 47 claims · $4.2M incurred" },
    output: {
      frequency_per_pu_per_yr: 0.044,
      severity_avg_usd: 89_362,
      trend_3yr_pct: 14.7,
      loss_ratio_3yr: 0.71,
    },
  },
  {
    name: "xgb_loss_freq.predict",
    ms: 28,
    input: { features: { fleet_size: 214, oos_vehicle: 0.27, hos_basic: 0.62, region: "south_central", commodity: "general_freight" } },
    output: {
      pred_claims_next_yr: 12.8,
      pi_80: [9.2, 16.7],
      shap_top: [
        { f: "oos_vehicle", v: +1.42 },
        { f: "hos_basic", v: +0.93 },
        { f: "fleet_size", v: +0.31 },
        { f: "commodity=general_freight", v: -0.18 },
      ],
    },
  },
];

export function ToolCallStream() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= CALLS.length) {
      const t = setTimeout(() => setStep(0), 4000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), 1700);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
        <Wrench size={12} /> tool calls · single triage run
      </div>
      <div className="space-y-3">
        <AnimatePresence>
          {CALLS.slice(0, step).map((c, i) => (
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
                  <pre className="mt-1 overflow-x-auto rounded bg-bg-card/80 p-2 font-mono text-2xs text-ink">
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
