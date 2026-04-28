"use client";

/**
 * ChunkingStrip — animated semantic chunker. Shows a long NTSB narrative
 * being split into chunks with overlap. Bars fill in left-to-right; chunk
 * boundaries highlight on hover.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const NARRATIVE = `On the night of August 14, 2020, a 2018 Freightliner Cascadia tractor with a tandem trailer combination was traveling eastbound on I-35 in central Texas. The driver, a 47-year-old male, had logged 9 hours and 47 minutes of on-duty time across two split-sleep periods, with only 4 hours of off-duty rest in the prior 24 hours per the ELD record. NTSB investigators determined that the driver experienced micro-sleep episodes consistent with cumulative fatigue. The combination unit drifted from the right-most lane onto the improved shoulder and impacted a disabled passenger vehicle. Two fatalities resulted. Toxicology screens were negative. Brake adjustment was within the FMCSR §393.47 limits at the time of post-incident inspection. The carrier had a Behavior Analysis and Safety Improvement Category (BASIC) score of 47.2 in the Hours-of-Service Compliance category, placing it above the FMCSA threshold for federal intervention.`;

type Chunk = { start: number; end: number; tokens: number };

function semanticSplit(text: string, target = 220, overlap = 30): Chunk[] {
  // Approximate: split on sentence boundaries; greedily pack to target token count.
  const sents = text.split(/(?<=[.!?])\s+/);
  const chunks: Chunk[] = [];
  let cur = "";
  let cursor = 0;
  let chunkStart = 0;
  for (const s of sents) {
    if ((cur + s).split(/\s+/).length > target && cur) {
      const end = cursor + cur.length;
      chunks.push({ start: chunkStart, end, tokens: Math.round(cur.split(/\s+/).length) });
      // Overlap: rewind by ~overlap tokens
      const words = cur.split(/\s+/);
      const overlapText = words.slice(-overlap).join(" ");
      cur = overlapText + " " + s;
      chunkStart = end - overlapText.length;
      cursor = end;
    } else {
      if (!cur) chunkStart = cursor;
      cur += (cur ? " " : "") + s;
    }
    cursor = chunkStart + cur.length;
  }
  if (cur) chunks.push({ start: chunkStart, end: chunkStart + cur.length, tokens: Math.round(cur.split(/\s+/).length) });
  return chunks;
}

export function ChunkingStrip() {
  const chunks = semanticSplit(NARRATIVE, 60, 12);
  const [revealed, setRevealed] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(chunks.length, i + 1);
      setRevealed(i);
      if (i >= chunks.length) clearInterval(id);
    }, 700);
    return () => clearInterval(id);
  }, [chunks.length]);

  return (
    <div className="card p-4">
      <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
        SemanticChunker · target ≈ 60 tok · overlap 12 tok · NTSB narrative excerpt
      </div>

      {/* Strip */}
      <div className="mt-3 h-3 w-full overflow-hidden rounded-md border border-border bg-bg-card">
        <div className="relative h-full w-full">
          {chunks.map((c, i) => {
            const left = (c.start / NARRATIVE.length) * 100;
            const w = ((c.end - c.start) / NARRATIVE.length) * 100;
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
          const span = NARRATIVE.slice(c.start, c.end);
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
