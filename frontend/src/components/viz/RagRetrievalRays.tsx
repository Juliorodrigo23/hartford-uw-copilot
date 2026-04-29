"use client";

/**
 * RagRetrievalRays — query embedding pulses in the center; rays radiate to
 * the top-k nearest documents. Ray thickness ∝ similarity score, and the
 * top match snaps in with a brighter pulse. Pure SVG, no 3D.
 */

import { motion } from "framer-motion";
import { useMemo } from "react";

type Hit = { id: string; src: string; score: number; title: string; angle: number; dist: number };

const HITS: Hit[] = [
  { id: "ntsb-2019-04", src: "ntsb", score: 0.882, title: "I-35 multi-veh · fatigue", angle: -15, dist: 1.0 },
  { id: "ntsb-2020-08", src: "ntsb", score: 0.851, title: "Doubles · run-off-road TX", angle: 35, dist: 1.04 },
  { id: "10k-knx-2023-rf", src: "10k", score: 0.794, title: "Knight-Swift · driver shortage", angle: -75, dist: 1.18 },
  { id: "10k-jbht-2023-rf", src: "10k", score: 0.771, title: "JB Hunt · safety program", angle: 100, dist: 1.22 },
  { id: "ntsb-2023-03", src: "ntsb", score: 0.746, title: "Fog pileup LA · visibility", angle: 175, dist: 1.32 },
  { id: "10k-wern-2022-rf", src: "10k", score: 0.703, title: "Werner · accident frequency", angle: 220, dist: 1.40 },
  { id: "industry-ata-2023", src: "industry", score: 0.661, title: "ATA 2023 economic outlook", angle: 280, dist: 1.50 },
  { id: "ntsb-2024-01", src: "ntsb", score: 0.612, title: "Hazmat bridge strike DC", angle: 320, dist: 1.62 },
];

const SRC_COLORS: Record<string, string> = {
  ntsb: "#60a5fa",
  "10k": "#fbbf24",
  forms: "#34d399",
  industry: "#c084fc",
};

export function RagRetrievalRays() {
  const center = { x: 360, y: 220 };
  const R = 130;
  const positions = useMemo(
    () =>
      HITS.map((h) => {
        const a = (h.angle * Math.PI) / 180;
        return {
          ...h,
          x: center.x + Math.cos(a) * R * h.dist,
          y: center.y + Math.sin(a) * R * h.dist,
        };
      }),
    [],
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          k-NN retrieval · cosine similarity · top-8 hits
        </div>
        <div className="ml-auto font-mono text-2xs text-ink">
          query: <span className="text-ink-dim">"long-haul fatigue claims, fleet &gt; 200 PUs, overnight runs"</span>
        </div>
      </div>
      <svg viewBox="0 0 720 440" className="h-[440px] w-full">
        <defs>
          <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fecaca" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#dc2626" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
          </radialGradient>
          <filter id="ray-glow">
            <feGaussianBlur stdDeviation="1.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Concentric reference rings */}
        {[0.6, 1.0, 1.4, 1.8].map((r) => (
          <circle
            key={r}
            cx={center.x}
            cy={center.y}
            r={R * r}
            fill="none"
            stroke="#1f2733"
            strokeDasharray="2 4"
          />
        ))}
        <text
          x={center.x + R * 1.0 + 4}
          y={center.y + 4}
          className="fill-ink-dim font-mono text-[10px]"
        >
          cos = 0.85
        </text>
        <text
          x={center.x + R * 1.4 + 4}
          y={center.y + 4}
          className="fill-ink-dim font-mono text-[10px]"
        >
          0.70
        </text>

        {/* Rays */}
        {positions.map((p, i) => {
          const c = SRC_COLORS[p.src] ?? "#9aa6b8";
          const w = 0.6 + p.score * 4;
          return (
            <motion.line
              key={p.id}
              x1={center.x}
              y1={center.y}
              x2={p.x}
              y2={p.y}
              stroke={c}
              strokeWidth={w}
              strokeOpacity={0.7}
              filter="url(#ray-glow)"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: i * 0.08, duration: 0.6, ease: "easeOut" }}
            />
          );
        })}

        {/* Center pulse */}
        <circle cx={center.x} cy={center.y} r={32} fill="url(#centerGlow)" />
        <motion.circle
          cx={center.x}
          cy={center.y}
          fill="#fecaca"
          initial={{ r: 6, opacity: 1 }}
          animate={{ r: [6, 9, 6], opacity: [1, 0.7, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <text
          x={center.x}
          y={center.y - 18}
          textAnchor="middle"
          className="fill-ink font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          query
        </text>

        {/* Doc nodes */}
        {positions.map((p, i) => {
          const c = SRC_COLORS[p.src] ?? "#9aa6b8";
          return (
            <motion.g
              key={p.id}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 + i * 0.08, duration: 0.3 }}
            >
              <circle cx={p.x} cy={p.y} r={5.5} fill={c} stroke="#0a0d12" strokeWidth={1.5} />
              <rect
                x={p.x + (p.angle > 90 && p.angle < 270 ? -200 : 10)}
                y={p.y - 16}
                width={190}
                height={28}
                rx={4}
                fill="#10141b"
                stroke="#1f2733"
              />
              <text
                x={p.x + (p.angle > 90 && p.angle < 270 ? -190 : 18)}
                y={p.y - 3}
                className="fill-ink text-[11px]"
              >
                {p.title}
              </text>
              <text
                x={p.x + (p.angle > 90 && p.angle < 270 ? -190 : 18)}
                y={p.y + 9}
                className="fill-ink-dim font-mono text-[9px]"
              >
                {p.id} · cos {p.score.toFixed(3)}
              </text>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
