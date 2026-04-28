"use client";

/**
 * HybridSearchBars — three columns side-by-side showing how BM25 and dense
 * retrieval rank a sample query, then how Reciprocal Rank Fusion + cross-
 * encoder rerank produces the final list. Emphasizes the "where each ranker
 * disagrees" story: BM25 picks up keyword matches the dense model misses,
 * dense picks up semantic matches the BM25 misses.
 */

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

type Doc = {
  id: string;
  title: string;
  source: string;
};

const DOCS: Doc[] = [
  { id: "ntsb-2019-04", title: "I-35 multi-vehicle crash · driver fatigue", source: "ntsb" },
  { id: "10k-knx-2023-rf", title: "Knight-Swift 10-K · risk factors · driver shortage", source: "10k" },
  { id: "ntsb-2022-12", title: "Jackknife I-10 · brake adjustment failure", source: "ntsb" },
  { id: "10k-wern-2022-rf", title: "Werner 10-K · accident frequency disclosures", source: "10k" },
  { id: "forms-iso-ca-0001", title: "ISO CA 00 01 · Business Auto Coverage Form", source: "forms" },
  { id: "ntsb-2020-08", title: "Doubles, fatigue · run-off-road TX", source: "ntsb" },
  { id: "10k-jbht-2023-rf", title: "JB Hunt 10-K · safety program disclosures", source: "10k" },
  { id: "ntsb-2023-03", title: "Fog pileup LA · visibility failure", source: "ntsb" },
  { id: "industry-ata-2023", title: "ATA 2023 economic outlook · trucking", source: "industry" },
  { id: "ntsb-2024-01", title: "Hazmat bridge strike · DC", source: "ntsb" },
];

const QUERIES = [
  {
    q: "long-haul fatigue claims for fleets > 200 power units, particularly overnight runs",
    bm25: ["ntsb-2020-08", "ntsb-2019-04", "10k-knx-2023-rf", "ntsb-2024-01", "ntsb-2022-12", "ntsb-2023-03", "10k-wern-2022-rf", "10k-jbht-2023-rf", "industry-ata-2023", "forms-iso-ca-0001"],
    dense: ["ntsb-2019-04", "ntsb-2020-08", "10k-jbht-2023-rf", "10k-knx-2023-rf", "10k-wern-2022-rf", "ntsb-2023-03", "industry-ata-2023", "ntsb-2022-12", "ntsb-2024-01", "forms-iso-ca-0001"],
  },
  {
    q: "brake adjustment failure root cause, jackknife on grade",
    bm25: ["ntsb-2022-12", "ntsb-2024-01", "ntsb-2019-04", "forms-iso-ca-0001", "10k-knx-2023-rf", "ntsb-2020-08", "ntsb-2023-03", "10k-wern-2022-rf", "10k-jbht-2023-rf", "industry-ata-2023"],
    dense: ["ntsb-2022-12", "ntsb-2019-04", "ntsb-2024-01", "ntsb-2020-08", "ntsb-2023-03", "10k-wern-2022-rf", "10k-knx-2023-rf", "10k-jbht-2023-rf", "industry-ata-2023", "forms-iso-ca-0001"],
  },
];

const SRC_COLORS: Record<string, string> = {
  ntsb: "#60a5fa",
  "10k": "#fbbf24",
  forms: "#34d399",
  industry: "#c084fc",
};

function rrf(rankings: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const r of rankings) {
    r.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// "Cross-encoder" fake rerank: shuffle within first 5 with a deterministic
// nudge based on title length (just for variety in the demo). Real backend
// uses ms-marco MiniLM cross-encoder.
function rerank(top: { id: string; score: number }[]): { id: string; score: number }[] {
  return [...top].slice(0, 8).sort((a, b) => {
    const lenA = (DOCS.find((d) => d.id === a.id)?.title.length ?? 0);
    const lenB = (DOCS.find((d) => d.id === b.id)?.title.length ?? 0);
    return b.score + lenB * 0.0005 - (a.score + lenA * 0.0005);
  });
}

export function HybridSearchBars() {
  const [qIdx, setQIdx] = useState(0);
  const q = QUERIES[qIdx];
  const fused = useMemo(() => rrf([q.bm25, q.dense]), [q]);
  const reranked = useMemo(() => rerank(fused), [fused]);

  function docMeta(id: string) {
    return DOCS.find((d) => d.id === id)!;
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Hybrid retrieval · BM25 + dense + RRF + cross-encoder rerank
        </div>
        <select
          className="ml-auto rounded-md border border-border bg-bg-card px-2 py-1 text-xs text-ink"
          value={qIdx}
          onChange={(e) => setQIdx(Number(e.target.value))}
        >
          {QUERIES.map((qq, i) => (
            <option key={qq.q} value={i}>
              {`#${i + 1} · ${qq.q.slice(0, 64)}…`}
            </option>
          ))}
        </select>
      </div>

      <div className="p-4">
        <div className="rounded-md border border-border bg-bg-subtle/50 p-3 font-mono text-xs text-ink">
          <span className="text-ink-dim">query →</span> {q.q}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Column title="BM25" subtitle="lexical · rank-bm25" docs={q.bm25.map((id) => ({ id, score: 1 }))} keyPrefix="bm25" />
          <Column title="Dense" subtitle="bge-large-en-v1.5 · cosine" docs={q.dense.map((id) => ({ id, score: 1 }))} keyPrefix="dense" />
          <Column title="RRF + rerank" subtitle="reciprocal rank fusion → ms-marco MiniLM" docs={reranked} keyPrefix="rrf" highlight />
        </div>

        <div className="mt-4 text-2xs text-ink-dim">
          BM25 surfaces the chunk titled <em>"Doubles, fatigue · run-off-road TX"</em> at the top — a literal keyword match for "fatigue".
          The dense model promotes <em>"I-35 multi-vehicle crash · driver fatigue"</em> first because the surrounding narrative is
          semantically closer to the long-haul query, even though the title shares fewer keywords. RRF balances both;
          the cross-encoder rerank then pushes documents whose <em>chunk-level</em> match is strongest, not just title-level.
        </div>
      </div>
    </div>
  );

  function Column({
    title,
    subtitle,
    docs,
    keyPrefix,
    highlight,
  }: {
    title: string;
    subtitle: string;
    docs: { id: string; score: number }[];
    keyPrefix: string;
    highlight?: boolean;
  }) {
    return (
      <div className={`card p-3 ${highlight ? "border-brand-700/40 bg-brand-700/5" : ""}`}>
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">{subtitle}</div>
            <div className="text-sm font-semibold">{title}</div>
          </div>
          {highlight && (
            <span className="rounded-full border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.18em] text-brand-400">
              final
            </span>
          )}
        </div>
        <ol className="space-y-1.5">
          {docs.slice(0, 8).map((d, i) => {
            const m = docMeta(d.id);
            return (
              <motion.li
                key={`${keyPrefix}-${d.id}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.25 }}
                className="flex items-center gap-2 rounded border border-border/60 bg-bg-card/60 px-2 py-1.5 text-2xs"
              >
                <span className="w-4 font-mono tabular-nums text-ink-dim">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: SRC_COLORS[m.source] ?? "#9aa6b8" }}
                />
                <span className="truncate text-ink">{m.title}</span>
              </motion.li>
            );
          })}
        </ol>
      </div>
    );
  }
}
