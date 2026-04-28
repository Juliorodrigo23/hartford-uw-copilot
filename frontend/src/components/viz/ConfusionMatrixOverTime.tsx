"use client";

/**
 * ConfusionMatrixOverTime — three model versions of a binary "claims-likely"
 * classifier. Each entry of the 2×2 matrix interpolates between versions; the
 * cell flashes when its value changes.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

type Matrix = { tp: number; fp: number; fn: number; tn: number };

const VERSIONS: { name: string; m: Matrix; auc: number; precision: number; recall: number; f1: number }[] = [
  {
    name: "v1 · baseline · fleet size only",
    m: { tp: 184, fp: 311, fn: 121, tn: 384 },
    auc: 0.62,
    precision: 0.371,
    recall: 0.603,
    f1: 0.46,
  },
  {
    name: "v2 · + SAFER features",
    m: { tp: 226, fp: 254, fn: 79, tn: 441 },
    auc: 0.74,
    precision: 0.471,
    recall: 0.741,
    f1: 0.575,
  },
  {
    name: "v3 · + isotonic + interaction terms",
    m: { tp: 252, fp: 188, fn: 53, tn: 507 },
    auc: 0.81,
    precision: 0.573,
    recall: 0.826,
    f1: 0.677,
  },
];

export function ConfusionMatrixOverTime() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % VERSIONS.length), 2400);
    return () => clearInterval(id);
  }, []);

  const v = VERSIONS[idx];
  const total = v.m.tp + v.m.fp + v.m.fn + v.m.tn;
  const cellMax = Math.max(v.m.tp, v.m.fp, v.m.fn, v.m.tn);

  function Cell({ label, val, accent }: { label: string; val: number; accent: string }) {
    const pct = (val / total) * 100;
    return (
      <motion.div
        key={`${idx}-${label}`}
        initial={{ scale: 0.92, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="card relative overflow-hidden p-3"
        style={{ background: accent + "08", borderColor: accent + "55" }}
      >
        <div className="font-mono text-2xs uppercase tracking-[0.18em]" style={{ color: accent }}>
          {label}
        </div>
        <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
          <motion.span
            key={val}
            initial={{ y: 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.35 }}
          >
            {val}
          </motion.span>
        </div>
        <div className="font-mono text-2xs text-ink-dim">{pct.toFixed(1)}%</div>
        <div className="absolute bottom-0 left-0 h-1" style={{ width: `${(val / cellMax) * 100}%`, background: accent }} />
      </motion.div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Confusion matrix over model versions
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-bg-card p-1 text-xs">
          {VERSIONS.map((v, i) => (
            <button
              key={v.name}
              onClick={() => setIdx(i)}
              className={`rounded px-2 py-1 ${idx === i ? "bg-bg-subtle text-ink" : "text-ink-muted"}`}
            >
              v{i + 1}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 text-xs text-ink-muted">{v.name}</div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="grid grid-cols-2 gap-2">
          <Cell label="True positive" val={v.m.tp} accent="#34d399" />
          <Cell label="False positive" val={v.m.fp} accent="#f87171" />
          <Cell label="False negative" val={v.m.fn} accent="#fbbf24" />
          <Cell label="True negative" val={v.m.tn} accent="#60a5fa" />
        </div>
        <div className="card p-3">
          <ul className="space-y-2">
            {[
              { l: "AUC", v: v.auc },
              { l: "Precision", v: v.precision },
              { l: "Recall", v: v.recall },
              { l: "F1", v: v.f1 },
            ].map((x) => (
              <li key={x.l}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-muted">{x.l}</span>
                  <span className="font-mono tabular-nums text-ink">{x.v.toFixed(3)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-bg-subtle">
                  <motion.div
                    className="h-full bg-gradient-to-r from-info-500 to-accent-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${x.v * 100}%` }}
                    transition={{ duration: 0.6 }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-border pt-3 text-2xs text-ink-dim">
            Validated on 1,000 held-out carriers. Threshold tuned per cost matrix:
            FN cost ≈ 4× FP cost (a missed adverse risk hurts more than a soft
            decline).
          </div>
        </div>
      </div>
    </div>
  );
}
