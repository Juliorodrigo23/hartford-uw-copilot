"use client";

/**
 * FreqSeverityHeatmap — 2D KDE of the (frequency, severity) joint density
 * per year, computed from the REAL synthesized loss runs shipped with the
 * demo (loss_landscape.json, script 08). The year scrubber morphs between
 * per-year snapshots; the moving marker traces the joint mean.
 */

import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/useData";
import { useAnimationGate } from "@/lib/useInView";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { LossLandscape } from "@/lib/api";

type Sample = { f: number; s: number; year: number };

export function FreqSeverityHeatmap() {
  const { data, status } = useData<LossLandscape>("loss_landscape.json");
  const ref = useRef<SVGSVGElement>(null);

  const years = useMemo(
    () => Array.from(new Set((data?.points ?? []).map((p) => p.year))).sort(),
    [data],
  );
  const [year, setYear] = useState<number | null>(null);
  const [auto, setAuto] = useState(true);
  const { ref: gateRef, active: gateActive } = useAnimationGate<HTMLDivElement>(0.35);
  const activeYear = year ?? years[years.length - 1] ?? null;

  // 4.5s per year is enough to actually read the density shift; the d3
  // contour recompute only runs while the card is on screen.
  useEffect(() => {
    if (!auto || !gateActive || years.length < 2) return;
    const id = setInterval(() => {
      setYear((y) => {
        const cur = y ?? years[years.length - 1];
        const i = years.indexOf(cur);
        return years[(i + 1) % years.length];
      });
    }, 4500);
    return () => clearInterval(id);
  }, [auto, gateActive, years]);

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !data || activeYear == null) return;
    const W = svg.clientWidth || 700;
    const H = svg.clientHeight || 360;
    const padL = 56,
      padR = 16,
      padT = 14,
      padB = 38;
    const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`);
    sel.selectAll("*").remove();

    const pts: Sample[] = data.points.filter((p) => p.year === activeYear);
    if (!pts.length) return;

    const fMax = Math.max(0.08, (d3.max(data.points, (d) => d.f) ?? 0.08) * 1.1);
    const sMax = Math.max(150, (d3.max(data.points, (d) => d.s) ?? 150) * 1.1);
    const xs = d3.scaleLinear().domain([0, fMax]).range([padL, W - padR]);
    const ys = d3.scaleLinear().domain([0, sMax]).range([H - padB, padT]);

    const density = d3
      .contourDensity<Sample>()
      .x((d) => xs(d.f))
      .y((d) => ys(d.s))
      .size([W, H])
      .bandwidth(26)
      .thresholds(12)(pts);

    const color = d3
      .scaleSequential(d3.interpolateRgbBasis(["transparent", "#1e3a8a", "#dc2626", "#fbbf24"]))
      .domain([0, d3.max(density, (d) => d.value) ?? 1]);

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

    // Individual account points
    sel
      .append("g")
      .selectAll("circle")
      .data(pts)
      .enter()
      .append("circle")
      .attr("cx", (d) => xs(d.f))
      .attr("cy", (d) => ys(d.s))
      .attr("r", 2.2)
      .attr("fill", "#e6ebf2")
      .attr("fill-opacity", 0.5);

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
    const fbar = d3.mean(pts, (d) => d.f) ?? 0;
    const sbar = d3.mean(pts, (d) => d.s) ?? 0;
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
      .text(String(activeYear));
  }, [data, activeYear]);

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading loss landscape…</div>;
  }
  if (status === "missing" || !data || !years.length) {
    return (
      <PendingCard
        title="Loss landscape not exported yet."
        command="uv run python scripts/05_synthesize_subs.py && uv run python scripts/08_export_viz_data.py"
      />
    );
  }

  return (
    <div ref={gateRef} className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          (Frequency × Severity) joint density · 2D KDE · demo loss runs
        </div>
        <DataBadge kind="live" note="synthesized loss runs" />
        <div className="ml-auto flex items-center gap-2 text-2xs text-ink-muted">
          <button className="btn-ghost" onClick={() => setAuto((a) => !a)}>
            {auto ? "auto" : "paused"}
          </button>
          <input
            type="range"
            min={years[0]}
            max={years[years.length - 1]}
            value={activeYear ?? years[0]}
            onChange={(e) => {
              setAuto(false);
              setYear(Number(e.target.value));
            }}
            className="h-1 w-32 cursor-pointer"
          />
          <span className="w-10 font-mono tabular-nums text-ink">{activeYear}</span>
        </div>
      </div>
      <svg ref={ref} className="h-[360px] w-full" />
    </div>
  );
}
