"use client";

/**
 * XGBSHAP — SHAP waterfall for one real submission + global importance,
 * both loaded from model_insights.json (real TreeExplainer output from the
 * trained booster; script 08). Pending card until the model is trained.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useData } from "@/lib/useData";
import { useAnimationGate } from "@/lib/useInView";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { ModelInsights } from "@/lib/api";

export function XGBSHAP() {
  const { data, status } = useData<ModelInsights>("model_insights.json");
  const [reveal, setReveal] = useState(0);
  const { ref: gateRef, active: gateActive, reduced } = useAnimationGate<HTMLDivElement>(0.3);
  const nFeatures = data?.waterfall?.features.length ?? 0;

  // One bar every 700ms, starting when the reader gets here.
  useEffect(() => {
    if (!nFeatures) return;
    if (reduced) {
      setReveal(nFeatures);
      return;
    }
    if (!gateActive) return;
    setReveal(0);
    const id = setInterval(() => setReveal((r) => Math.min(nFeatures, r + 1)), 700);
    return () => clearInterval(id);
  }, [nFeatures, gateActive, reduced]);

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading model insights…</div>;
  }
  if (status === "missing" || !data) {
    return (
      <PendingCard
        title="Model artifacts not exported yet."
        command="uv run python scripts/06_train_xgb.py && uv run python scripts/08_export_viz_data.py"
      />
    );
  }

  const wf = data.waterfall;
  const global = data.global_importance;
  const maxGlobal = global[0]?.v || 1;

  // Waterfall geometry
  const base = wf?.base_value ?? 0;
  const ordered = wf ? [...wf.features].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)) : [];
  let acc = base;
  const rows = ordered.map((f, i) => {
    const start = acc;
    if (i < reveal) acc += f.v;
    return { ...f, start, end: i < reveal ? start + f.v : start };
  });
  const finalPred = wf ? wf.pred_claims_next_yr : 0;
  const span = Math.max(1, Math.abs(finalPred - base) * 2, ...rows.map((r) => Math.abs(r.end - base)));
  const scale = 150 / span;
  const x = (v: number) => 150 + (v - base) * scale;

  return (
    <div ref={gateRef} className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <DataBadge
          kind="live"
          note={`${data.version} · trained on ${data.training_data === "parquet" ? "processed FMCSA frame" : "disclosed synthetic frame"}`}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            {wf
              ? `SHAP waterfall · ${wf.submission_id} · DOT ${wf.dot_number} · pred ${wf.pred_claims_next_yr.toFixed(1)} claims (80% PI ${wf.pi_80[0].toFixed(1)}–${wf.pi_80[1].toFixed(1)})`
              : "SHAP waterfall unavailable"}
          </div>
          {wf ? (
            <svg viewBox="0 0 460 320" className="mt-2 w-full">
              <line x1={x(base)} y1={10} x2={x(base)} y2={300} stroke="#1f2733" />
              <text x={x(base)} y={312} textAnchor="middle" className="fill-ink-dim font-mono text-[10px]">
                E[log rate] {base.toFixed(2)}
              </text>
              {rows.map((r, i) => {
                const y = 24 + i * 34;
                const x0 = x(r.start);
                const x1 = x(r.end);
                const positive = r.v >= 0;
                const w = Math.max(2, Math.abs(x1 - x0));
                const bx = Math.min(x0, x1);
                const color = positive ? "#f87171" : "#34d399";
                return (
                  <motion.g key={r.f} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                    <text x={142} y={y + 4} textAnchor="end" className="fill-ink text-[11px]">
                      {r.f}
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
                      {r.v.toFixed(2)}
                    </text>
                  </motion.g>
                );
              })}
            </svg>
          ) : (
            <div className="mt-2 text-xs text-warn-400">
              No cached SAFER profile matched a submission at export time.
            </div>
          )}
        </div>

        <div>
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            Global importance · mean(|SHAP|) · {data.n_train.toLocaleString()} training carriers
          </div>
          <ul className="mt-2 space-y-1.5">
            {global.map((g, i) => (
              <li key={g.name} className="flex items-center gap-2 text-xs">
                <span className="w-32 truncate text-ink">{g.name}</span>
                <div className="relative h-3 flex-1 rounded bg-bg-subtle">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-brand-700 to-brand-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${(g.v / maxGlobal) * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.04 }}
                  />
                </div>
                <span className="w-12 font-mono tabular-nums text-ink-muted">{g.v.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-border pt-3 text-2xs text-ink-dim">
            5-fold grouped CV (by carrier) · mean AUC{" "}
            {(
              data.cv_metrics.reduce((s, m) => s + m.auc, 0) / Math.max(1, data.cv_metrics.length)
            ).toFixed(3)}{" "}
            on the adverse-frequency binarization · Brier improves{" "}
            {data.calibration.brier_raw.toFixed(4)} → {data.calibration.brier_calibrated.toFixed(4)}{" "}
            with isotonic calibration.
            {data.training_data === "synthetic" && (
              <>
                {" "}Training targets are synthetic (public data has no per-carrier
                claim outcomes) with FMCSA-consistent feature structure; the
                pipeline swaps in `carriers_train.parquet` untouched when real
                outcomes are available.
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
