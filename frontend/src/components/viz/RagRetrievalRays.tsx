"use client";

/**
 * RagRetrievalRays — query embedding pulses in the center; rays radiate to
 * the top-k retrieved chunks. Hits come from retrieval_example.json; a
 * finite RRF fallback is used when the cross-encoder is unavailable. Ray
 * thickness is proportional to the active final-stage score. Pure SVG.
 */

import { motion } from "framer-motion";
import { useMemo } from "react";
import { useData } from "@/lib/useData";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { RetrievalExample } from "@/lib/api";

const SRC_COLORS: Record<string, string> = {
  ntsb: "#60a5fa",
  "10k": "#fbbf24",
  forms: "#34d399",
  industry: "#c084fc",
};

export function RagRetrievalRays() {
  const { data, status } = useData<RetrievalExample>("retrieval_example.json");

  const hits = useMemo(() => {
    const reranked = data?.queries?.[0]?.reranked ?? [];
    const top = reranked.slice(0, 8);
    if (!top.length) return [];
    const scores = top.map((h) => h.score);
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    return top.map((h, i) => {
      const norm = hi > lo ? (h.score - lo) / (hi - lo) : 0.5;
      const angle = -15 + i * (360 / Math.max(1, top.length));
      const a = (angle * Math.PI) / 180;
      const dist = 1.0 + (1 - norm) * 0.6;
      return {
        ...h,
        norm,
        x: 360 + Math.cos(a) * 130 * dist,
        y: 220 + Math.sin(a) * 130 * dist,
      };
    });
  }, [data]);

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading retrieval example…</div>;
  }
  if (status === "missing" || !hits.length) {
    return (
      <PendingCard
        title="Retrieval data sync did not complete. The no-model fallback can repair it."
        command="cd frontend && pnpm run data:sync"
      />
    );
  }

  const isPipeline = data?.provenance?.kind === "pipeline";

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Query → nearest chunks · {isPipeline ? "rerank" : "finite RRF fallback"} scores
        </div>
        <DataBadge
          kind={isPipeline ? "live" : "illustrative"}
          note={isPipeline ? undefined : "real-export-derived deterministic fallback"}
        />
      </div>
      <svg viewBox="0 0 720 440" className="mt-2 w-full">
        {/* rays */}
        {hits.map((h, i) => (
          <motion.line
            key={h.id}
            x1={360}
            y1={220}
            x2={h.x}
            y2={h.y}
            stroke={SRC_COLORS[h.source] ?? "#9aa6b8"}
            strokeOpacity={0.25 + h.norm * 0.6}
            strokeWidth={0.8 + h.norm * 3}
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1.1, delay: i * 0.25 }}
          />
        ))}
        {/* query node */}
        <motion.circle
          cx={360}
          cy={220}
          r={12}
          fill="#dc2626"
          animate={{ opacity: [1, 0.55, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <text x={360} y={252} textAnchor="middle" className="fill-ink-dim font-mono text-[10px]">
          query {isPipeline ? "embedding" : "fusion"}
        </text>
        {/* hit nodes */}
        {hits.map((h, i) => (
          <motion.g
            key={h.id}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ delay: 0.6 + i * 0.25 }}
          >
            <circle cx={h.x} cy={h.y} r={6 + h.norm * 4} fill={SRC_COLORS[h.source] ?? "#9aa6b8"} fillOpacity={0.85} />
            <text
              x={h.x}
              y={h.y - 12}
              textAnchor="middle"
              className="fill-ink font-mono text-[9px]"
            >
              {h.id.length > 26 ? h.id.slice(0, 26) + "…" : h.id}
            </text>
            <text x={h.x} y={h.y + 20} textAnchor="middle" className="fill-ink-dim font-mono text-[9px]">
              {h.score.toFixed(3)}
            </text>
          </motion.g>
        ))}
      </svg>
      <div className="mt-1 truncate font-mono text-2xs text-ink-dim" title={data!.queries[0].query}>
        “{data!.queries[0].query}”
      </div>
    </div>
  );
}
