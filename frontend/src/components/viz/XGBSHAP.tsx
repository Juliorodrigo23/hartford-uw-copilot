"use client";

/**
 * XGBSHAP — animated SHAP waterfall for a single submission, plus a global
 * importance bar chart. The waterfall draws bar-by-bar; the prediction at
 * the bottom interpolates as bars accumulate.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

type Feat = { name: string; value: string; shap: number };

const SAMPLE: { base: number; pred: number; features: Feat[] } = {
  base: 4.8, // base value: log expected claims
  pred: 12.8,
  features: [
    { name: "oos_vehicle", value: "0.27", shap: +3.7 },
    { name: "hos_basic_score", value: "62", shap: +2.6 },
    { name: "fleet_size", value: "214 PUs", shap: +1.1 },
    { name: "vehicle_mix=tractor", value: "0.78", shap: +0.6 },
    { name: "region", value: "south_central", shap: +0.4 },
    { name: "commodity", value: "general_freight", shap: -0.4 },
    { name: "years_in_op", value: "12", shap: +0.3 },
    { name: "loss_ratio_3yr", value: "0.71", shap: -0.3 },
  ],
};

const GLOBAL = [
  { name: "oos_vehicle", v: 0.182 },
  { name: "hos_basic_score", v: 0.156 },
  { name: "loss_ratio_3yr", v: 0.142 },
  { name: "fleet_size", v: 0.128 },
  { name: "severity_avg", v: 0.097 },
  { name: "vehicle_mix=tractor", v: 0.083 },
  { name: "region", v: 0.075 },
  { name: "commodity", v: 0.068 },
  { name: "years_in_op", v: 0.041 },
  { name: "ifta_miles", v: 0.028 },
];

export function XGBSHAP() {
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setReveal((r) => Math.min(SAMPLE.features.length, r + 1)), 220);
    return () => clearInterval(id);
  }, []);

  const ordered = [...SAMPLE.features].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));
  // Running sum
  let acc = SAMPLE.base;
  const rows = ordered.map((f, i) => {
    const start = acc;
    if (i < reveal) acc += f.shap;
    return { ...f, start, end: i < reveal ? start + f.shap : start };
  });
  const finalPred = rows.reduce((p, r) => (r.end !== r.start ? r.end : p), SAMPLE.base);

  return (
    <div className="card p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            SHAP waterfall · single submission · DOT 2839412
          </div>
          <svg viewBox="0 0 460 320" className="mt-2 w-full">
            <line x1={120} y1={10} x2={120} y2={300} stroke="#1f2733" />
            <text x={120} y={300} textAnchor="middle" className="fill-ink-dim font-mono text-[10px]">
              base {SAMPLE.base.toFixed(1)}
            </text>
            <line
              x1={120 + (SAMPLE.pred - SAMPLE.base) * 18}
              y1={10}
              x2={120 + (SAMPLE.pred - SAMPLE.base) * 18}
              y2={300}
              stroke="#fecaca"
              strokeDasharray="3 3"
            />
            <text
              x={120 + (SAMPLE.pred - SAMPLE.base) * 18}
              y={300}
              textAnchor="middle"
              className="fill-brand-400 font-mono text-[10px]"
            >
              pred {finalPred.toFixed(1)}
            </text>

            {rows.map((r, i) => {
              const y = 24 + i * 32;
              const x0 = 120 + (r.start - SAMPLE.base) * 18;
              const x1 = 120 + (r.end - SAMPLE.base) * 18;
              const positive = r.shap >= 0;
              const w = Math.max(2, Math.abs(x1 - x0));
              const bx = Math.min(x0, x1);
              const color = positive ? "#f87171" : "#34d399";
              return (
                <motion.g
                  key={r.name}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <text x={114} y={y + 4} textAnchor="end" className="fill-ink text-[11px]">
                    {r.name}
                  </text>
                  <text x={114} y={y + 16} textAnchor="end" className="fill-ink-dim font-mono text-[9px]">
                    = {r.value}
                  </text>
                  <motion.rect
                    initial={{ width: 0 }}
                    animate={{ width: i < reveal ? w : 0 }}
                    transition={{ duration: 0.4 }}
                    x={bx}
                    y={y - 6}
                    height={14}
                    fill={color}
                    fillOpacity={0.85}
                    rx={2}
                  />
                  <text
                    x={positive ? bx + w + 4 : bx - 4}
                    y={y + 4}
                    textAnchor={positive ? "start" : "end"}
                    className="fill-ink font-mono text-[10px]"
                  >
                    {positive ? "+" : ""}
                    {r.shap.toFixed(1)}
                  </text>
                </motion.g>
              );
            })}
          </svg>
        </div>

        <div>
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            Global importance · mean(|SHAP|) · 50K test samples
          </div>
          <ul className="mt-2 space-y-1.5">
            {GLOBAL.map((g, i) => (
              <li key={g.name} className="flex items-center gap-2 text-xs">
                <span className="w-32 truncate text-ink">{g.name}</span>
                <div className="relative h-3 flex-1 rounded bg-bg-subtle">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-brand-700 to-brand-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${(g.v / GLOBAL[0].v) * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.04 }}
                  />
                </div>
                <span className="w-10 font-mono tabular-nums text-ink-muted">{g.v.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-border pt-3 text-2xs text-ink-dim">
            Out-of-sample R² = 0.41 on next-year claim count (Poisson deviance reduction = 27%
            over the carrier-fleet-size baseline). Calibrated with isotonic regression
            against held-out 2023 claims.
          </div>
        </div>
      </div>
    </div>
  );
}
