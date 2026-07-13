"use client";

/**
 * ChunkingStrip — semantic-chunker boundaries visualized on real corpus
 * text. Loads chunking_example.json (real chunker output on a real NTSB
 * narrative, script 08). Until that exists it demonstrates the same
 * boundary-packing idea on a sample paragraph, clearly badged as an
 * algorithm demo rather than pipeline output.
 */

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/useData";
import { useAnimationGate } from "@/lib/useInView";
import { DataBadge } from "@/components/DataBadge";
import type { ChunkingExample } from "@/lib/api";

const SAMPLE_TEXT = `On the night of the incident, a tractor with a tandem trailer combination was traveling eastbound on an interstate in central Texas. The driver had logged over nine hours of on-duty time across two split-sleep periods, with limited off-duty rest in the prior 24 hours per the ELD record. Investigators identified micro-sleep episodes consistent with cumulative fatigue. The combination unit drifted from the right-most lane onto the improved shoulder and struck a disabled passenger vehicle. Toxicology screens were negative. Brake adjustment was within regulatory limits at post-incident inspection. The carrier's Hours-of-Service Compliance score placed it above the federal intervention threshold.`;

type Chunk = { start: number; end: number; tokens: number };

function sampleSplit(text: string, target = 60, overlap = 12): Chunk[] {
  const sents = text.split(/(?<=[.!?])\s+/);
  const chunks: Chunk[] = [];
  let cur = "";
  let chunkStart = 0;
  let cursor = 0;
  for (const s of sents) {
    if ((cur + s).split(/\s+/).length > target && cur) {
      const end = chunkStart + cur.length;
      chunks.push({ start: chunkStart, end, tokens: cur.split(/\s+/).length });
      const words = cur.split(/\s+/);
      const overlapText = words.slice(-overlap).join(" ");
      chunkStart = end - overlapText.length;
      cur = overlapText + " " + s;
    } else {
      if (!cur) chunkStart = cursor;
      cur += (cur ? " " : "") + s;
    }
    cursor = chunkStart + cur.length;
  }
  if (cur) chunks.push({ start: chunkStart, end: chunkStart + cur.length, tokens: cur.split(/\s+/).length });
  return chunks;
}

export function ChunkingStrip() {
  const { data, status } = useData<ChunkingExample>("chunking_example.json");
  const [revealed, setRevealed] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const { ref: gateRef, active: gateActive, reduced } = useAnimationGate<HTMLDivElement>(0.3);

  const { text, chunks, live, docId } = useMemo(() => {
    if (status === "live" && data?.chunks?.length) {
      return { text: data.text, chunks: data.chunks, live: true, docId: data.doc_id };
    }
    return { text: SAMPLE_TEXT, chunks: sampleSplit(SAMPLE_TEXT), live: false, docId: null as string | null };
  }, [data, status]);

  // Reveal begins when the reader arrives (not at page load), one chunk per
  // 1.2s so each boundary registers. Reduced motion: show everything at once.
  useEffect(() => {
    if (reduced) {
      setRevealed(chunks.length);
      return;
    }
    if (!gateActive) return;
    setRevealed(0);
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(chunks.length, i + 1);
      setRevealed(i);
      if (i >= chunks.length) clearInterval(id);
    }, 1200);
    return () => clearInterval(id);
  }, [chunks, gateActive, reduced]);

  return (
    <div ref={gateRef} className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          SemanticChunker · cosine-distance breakpoints · target ≈ 60 tok · overlap 12
        </div>
        {live ? (
          <DataBadge kind="live" note={`real chunker on ${docId}`} />
        ) : (
          <DataBadge kind="illustrative" note="algorithm demo on sample text — run scripts/02 + 08 for real corpus output" />
        )}
      </div>

      {/* Strip */}
      <div className="mt-3 h-3 w-full overflow-hidden rounded-md border border-border bg-bg-card">
        <div className="relative h-full w-full">
          {chunks.map((c, i) => {
            const left = (c.start / text.length) * 100;
            const w = ((c.end - c.start) / text.length) * 100;
            return (
              <motion.div
                key={i}
                className={`absolute top-0 h-full cursor-pointer ${
                  hover === i ? "z-20 ring-2 ring-brand-500/60" : "z-10"
                }`}
                style={{
                  left: `${left}%`,
                  width: `${w}%`,
                  background: i % 2 === 0 ? "rgba(96,165,250,0.5)" : "rgba(52,211,153,0.5)",
                  borderLeft: "1px solid #0a0d12",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: i < revealed ? 0.85 : 0 }}
                transition={{ duration: 0.35 }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </div>
      </div>

      {/* Text with chunk highlights */}
      <div className="mt-4 max-h-48 overflow-y-auto rounded-md border border-border bg-bg-subtle/50 p-3 text-sm leading-relaxed text-ink">
        {chunks.slice(0, revealed).map((c, i) => {
          const span = text.slice(c.start, c.end);
          const isHov = hover === i;
          return (
            <span
              key={i}
              className={`whitespace-pre-wrap rounded px-1 transition-colors ${
                isHov ? "bg-brand-500/15 text-ink" : "text-ink-muted"
              }`}
              style={{
                background: isHov ? undefined : i % 2 === 0 ? "rgba(96,165,250,0.06)" : "rgba(52,211,153,0.06)",
              }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {span}{" "}
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-2xs text-ink-dim">
        <div>
          {chunks.length} chunks · avg{" "}
          {Math.round(chunks.reduce((s, c) => s + c.tokens, 0) / Math.max(1, chunks.length))} tok/chunk
        </div>
        <div>
          {hover != null && chunks[hover] ? (
            <span>
              chunk {hover + 1} · [{chunks[hover].start}–{chunks[hover].end}] · ~{chunks[hover].tokens} tok
            </span>
          ) : (
            <span>hover a band to inspect</span>
          )}
        </div>
      </div>
    </div>
  );
}
