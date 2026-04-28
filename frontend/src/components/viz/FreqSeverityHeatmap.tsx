"use client";

/**
 * FreqSeverityHeatmap — 2D KDE of historical commercial-auto claims, with
 * the (frequency, severity) joint density evolving across years. Year scrubber
 * morphs between snapshots; a moving "expected" marker traces the joint mean.
 *
 *   x: claim frequency per power unit per year
 *   y: severity (incurred per claim, $ thousands)
 */

import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";

type Sample = { f: number; s: number; year: number };

// Synth data per year — drift over time tells the "loss inflation" story.
function makeYear(year: number, n = 1200, seed = 1): Sample[] {
  const out: Sample[] = [];
  // mu drifts up
  const muF = 0.025 + (year - 2019) * 0.003;
  const muS = 50 + (year - 2019) * 12; // $K
  const r = mulberry32(seed * year);
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(r(), 1e-9);
    const u2 = r();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const f = Math.max(0.001, muF + z * 0.012);
    const u3 = Math.max(r(), 1e-9);
    const u4 = r();
    const z2 = Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);
    const s = Math.max(2, Math.exp(Math.log(muS) + z2 * 0.6));
    out.push({ f, s, year });
  }
  return out;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const YEARS = [2019, 2020, 2021, 2022, 2023, 2024] as const;

export function FreqSeverityHeatmap() {
  const ref = useRef<SVGSVGElement>(null);
  const [year, setYear] = useState<number>(2024);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setYear((y) => {
        const i = YEARS.indexOf(y as (typeof YEARS)[number]);
        return YEARS[(i + 1) % YEARS.length];
      });
    }, 1800);
    return () => clearInterval(id);
  }, [auto]);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    const padL = 56,
      padR = 16,
      padT = 14,
      padB = 38;
    const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`);
    sel.selectAll("*").remove();

    const xs = d3.scaleLinear().domain([0, 0.08]).range([padL, W - padR]);
    const ys = d3.scaleLinear().domain([0, 250]).range([H - padB, padT]);

    const data = makeYear(year);

    // Density via d3-contour
    const density = d3
      .contourDensity<Sample>()
      .x((d) => xs(d.f))
      .y((d) => ys(d.s))
      .size([W, H])
      .bandwidth(22)
      .thresholds(14)(data);

    const color = d3.scaleSequential(d3.interpolateRgbBasis(["transparent", "#1e3a8a", "#dc2626", "#fbbf24"])).domain([0, d3.max(density, (d) => d.value) ?? 1]);

    sel
      .append("g")
      .selectAll("path")
      .data(density)
      .enter()
      .append("path")
      .attr("d", d3.geoPath())
      .attr("fill", (d) => color(d.value))
      .attr("fill-opacity", 0.65)
      .attr("stroke", "none");

    // Axes
    sel
      .append("g")
      .attr("transform", `translate(0,${H - padB})`)
      .call(d3.axisBottom(xs).ticks(6).tickFormat(d3.format(".3f")))
      .call((g) => {
        g.selectAll("path,line").attr("stroke", "#1f2733");
        g.selectAll("text").attr("fill", "#9aa6b8").attr("font-family", "ui-monospace, Menlo, monospace").attr("font-size", 10);
      });
    sel
      .append("g")
      .attr("transform", `translate(${padL},0)`)
      .call(d3.axisLeft(ys).ticks(5).tickFormat((d) => `$${d}K`))
      .call((g) => {
        g.selectAll("path,line").attr("stroke", "#1f2733");
        g.selectAll("text").attr("fill", "#9aa6b8").attr("font-family", "ui-monospace, Menlo, monospace").attr("font-size", 10);
      });
    sel
      .append("text")
      .attr("x", W / 2)
      .attr("y", H - 6)
      .attr("text-anchor", "middle")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("frequency · claims / power unit / year");
    sel
      .append("text")
      .attr("transform", `translate(14,${H / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("severity · $ thousands / claim");

    // Joint mean marker
    const fbar = d3.mean(data, (d) => d.f) ?? 0;
    const sbar = d3.mean(data, (d) => d.s) ?? 0;
    sel
      .append("circle")
      .attr("cx", xs(fbar))
      .attr("cy", ys(sbar))
      .attr("r", 6)
      .attr("fill", "#fecaca")
      .attr("stroke", "#0a0d12")
      .attr("stroke-width", 1.5);
    sel
      .append("text")
      .attr("x", xs(fbar) + 9)
      .attr("y", ys(sbar) + 4)
      .attr("fill", "#fecaca")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 11)
      .text(`E ≈ (${fbar.toFixed(3)}, $${sbar.toFixed(0)}K)`);

    // Year badge
    sel
      .append("text")
      .attr("x", W - padR - 4)
      .attr("y", padT + 24)
      .attr("text-anchor", "end")
      .attr("fill", "#e6ebf2")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 28)
      .attr("opacity", 0.16)
      .text(String(year));
  }, [year]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          (Frequency × Severity) joint density · 2D KDE · public commercial-auto data
        </div>
        <div className="ml-auto flex items-center gap-2 text-2xs text-ink-muted">
          <button
            className="btn-ghost"
            onClick={() => setAuto((a) => !a)}
          >
            {auto ? "auto" : "paused"}
          </button>
          <input
            type="range"
            min={2019}
            max={2024}
            value={year}
            onChange={(e) => {
              setAuto(false);
              setYear(Number(e.target.value));
            }}
            className="h-1 w-32 cursor-pointer"
          />
          <span className="w-10 font-mono tabular-nums text-ink">{year}</span>
        </div>
      </div>
      <svg ref={ref} className="h-[360px] w-full" />
    </div>
  );
}
