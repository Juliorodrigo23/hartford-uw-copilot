"use client";

/**
 * ConfusionMatrixOverTime — three REAL feature-ablation versions of the
 * adverse-frequency classifier, with out-of-fold confusion matrices and
 * metrics loaded from model_insights.json (script 06 trains all three with
 * the same grouped CV split).
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useData } from "@/lib/useData";
import { useAnimationGate } from "@/lib/useInView";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { ModelInsights } from "@/lib/api";

export function ConfusionMatrixOverTime() {
  const { data, status } = useData<ModelInsights>("model_insights.json");
  const [idx, setIdx] = useState(0);
  const [hovered, setHovered] = useState(false);
  const { ref: gateRef, active: gateActive } = useAnimationGate<HTMLDivElement>(0.35);
  const versions = data?.model_versions ?? [];

  // Human pace: 9s per version (there are 4 numbers + 4 metrics to read),
  // only while on screen, and paused while the reader hovers the card.
  useEffect(() => {
    if (versions.length < 2 || !gateActive || hovered) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % versions.length), 9000);
    return () => clearInterval(id);
  }, [versions.length, gateActive, hovered]);

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading model versions…</div>;
  }
  if (status === "missing" || !data || !versions.length) {
    return (
      <PendingCard
        title="Model version metrics not exported yet."
        command="uv run python scripts/06_train_xgb.py && uv run python scripts/08_export_viz_data.py"
      />
    );
  }

  const v = versions[Math.min(idx, versions.length - 1)];
  const total = v.confusion.tp + v.confusion.fp + v.confusion.fn + v.confusion.tn;
  const cellMax = Math.max(v.confusion.tp, v.confusion.fp, v.confusion.fn, v.confusion.tn);

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
          <motion.span key={val} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.35 }}>
            {val.toLocaleString()}
          </motion.span>
        </div>
        <div className="font-mono text-2xs text-ink-dim">{pct.toFixed(1)}%</div>
        <div className="absolute bottom-0 left-0 h-1" style={{ width: `${(val / cellMax) * 100}%`, background: accent }} />
      </motion.div>
    );
  }

  return (
    <div
      ref={gateRef}
      className="card p-4"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Confusion matrix over model versions
        </div>
        <DataBadge kind="live" note="historical synthetic export; calibrated v3 uses calibration fit rows" />
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-bg-card p-1 text-xs">
          {versions.map((mv, i) => (
            <button
              key={mv.name}
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
          <Cell label="True positive" val={v.confusion.tp} accent="#34d399" />
          <Cell label="False positive" val={v.confusion.fp} accent="#f87171" />
          <Cell label="False negative" val={v.confusion.fn} accent="#fbbf24" />
          <Cell label="True negative" val={v.confusion.tn} accent="#60a5fa" />
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
            Target: adverse frequency (≥ 5 claims per 100 power units next
            year). Metrics are out-of-fold across a 5-fold grouped CV on{" "}
            {data.n_train.toLocaleString()} carriers; threshold 0.5 on the
            exact Poisson tail probability.
          </div>
        </div>
      </div>
    </div>
  );
}
