"use client";

/**
 * HybridSearchBars — how BM25, dense retrieval, RRF fusion, and the
 * cross-encoder rerank each order the corpus for a golden query. Every
 * ranking comes from the REAL pipeline (retrieval_example.json, produced by
 * hybrid_search.search_stages in script 08). Pending until the index exists.
 */

import { motion } from "framer-motion";
import { useState } from "react";
import { useData } from "@/lib/useData";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { RetrievalExample, RetrievalStageHit } from "@/lib/api";

const SRC_COLORS: Record<string, string> = {
  ntsb: "#60a5fa",
  "10k": "#fbbf24",
  forms: "#34d399",
  industry: "#c084fc",
};

export function HybridSearchBars() {
  const { data, status } = useData<RetrievalExample>("retrieval_example.json");
  const [qi, setQi] = useState(0);

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading retrieval example…</div>;
  }
  if (status === "missing" || !data?.queries?.length) {
    return (
      <PendingCard
        title="Per-stage retrieval rankings not exported yet (the index must exist first)."
        command="uv run python scripts/02_download_ntsb.py && ... 04_build_index.py && 08_export_viz_data.py"
      />
    );
  }

  const q = data.queries[Math.min(qi, data.queries.length - 1)];
  const columns: { title: string; hits: RetrievalStageHit[] }[] = [
    { title: "BM25 (keyword)", hits: q.bm25 },
    { title: "Dense (bge embeddings)", hits: q.dense },
    { title: "RRF + cross-encoder rerank", hits: q.reranked },
  ];
  const rerankTop = new Set(q.reranked.slice(0, 3).map((h) => h.id));

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Hybrid retrieval · real per-stage rankings
        </div>
        <DataBadge kind="live" />
        {data.queries.length > 1 && (
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-bg-card p-1 text-xs">
            {data.queries.map((_, i) => (
              <button
                key={i}
                onClick={() => setQi(i)}
                className={`rounded px-2 py-1 ${qi === i ? "bg-bg-subtle text-ink" : "text-ink-muted"}`}
              >
                Q{i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 rounded-md border border-border bg-bg-subtle/40 px-3 py-2 font-mono text-xs text-ink">
        “{q.query}”
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {columns.map((col, ci) => (
          <div key={col.title} className="card p-2">
            <div className="mb-2 px-1 font-mono text-2xs uppercase tracking-[0.16em] text-ink-dim">
              {col.title}
            </div>
            <ol className="space-y-1">
              {col.hits.slice(0, 8).map((h, i) => {
                const color = SRC_COLORS[h.source] ?? "#9aa6b8";
                const promoted = ci === 2 && rerankTop.has(h.id);
                return (
                  <motion.li
                    key={h.id}
                    initial={{ opacity: 0, x: -6 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ delay: ci * 0.35 + i * 0.12 }}
                    className={`rounded-md border px-2 py-1.5 text-xs ${
                      promoted ? "border-accent-500/50 bg-accent-500/10" : "border-border bg-bg-card/60"
                    }`}
                    title={h.snippet}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-2xs tabular-nums text-ink-dim">{i + 1}</span>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      <span className="truncate font-mono text-ink">{h.id}</span>
                      <span className="ml-auto font-mono text-2xs tabular-nums text-ink-dim">
                        {h.score.toFixed(3)}
                      </span>
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <div className="mt-3 text-2xs text-ink-dim">
        Where the columns disagree is the whole argument for hybrid: BM25
        catches exact terminology, dense catches semantics, RRF fuses both,
        and the cross-encoder reorders the fused pool with full query-passage
        attention.
      </div>
    </div>
  );
}
