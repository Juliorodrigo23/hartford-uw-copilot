"use client";

/**
 * CalibrationCurve — animated reliability diagram for the loss-frequency
 * model. Predicted decile mean vs empirical mean, with histogram of bin
 * sizes underneath. Two series: pre-calibration (raw XGB output) and post-
 * isotonic. The diagonal is the perfect-calibration reference.
 */

import * as d3 from "d3";
import { useEffect, useRef } from "react";

const RAW = [
  { p: 0.05, e: 0.062, n: 4820 },
  { p: 0.12, e: 0.158, n: 4140 },
  { p: 0.21, e: 0.262, n: 3950 },
  { p: 0.32, e: 0.378, n: 3680 },
  { p: 0.43, e: 0.48, n: 3520 },
  { p: 0.54, e: 0.572, n: 3340 },
  { p: 0.66, e: 0.66, n: 3210 },
  { p: 0.77, e: 0.732, n: 3060 },
  { p: 0.86, e: 0.81, n: 2920 },
  { p: 0.95, e: 0.872, n: 2710 },
];

const CAL = [
  { p: 0.05, e: 0.052, n: 4820 },
  { p: 0.12, e: 0.131, n: 4140 },
  { p: 0.21, e: 0.218, n: 3950 },
  { p: 0.32, e: 0.323, n: 3680 },
  { p: 0.43, e: 0.434, n: 3520 },
  { p: 0.54, e: 0.546, n: 3340 },
  { p: 0.66, e: 0.659, n: 3210 },
  { p: 0.77, e: 0.768, n: 3060 },
  { p: 0.86, e: 0.857, n: 2920 },
  { p: 0.95, e: 0.946, n: 2710 },
];

export function CalibrationCurve() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    const padL = 50,
      padR = 16,
      padT = 14,
      padB = 70;
    const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`);
    sel.selectAll("*").remove();

    const xs = d3.scaleLinear().domain([0, 1]).range([padL, W - padR]);
    const ys = d3.scaleLinear().domain([0, 1]).range([H - padB, padT]);

    // Diagonal
    sel
      .append("line")
      .attr("x1", xs(0))
      .attr("y1", ys(0))
      .attr("x2", xs(1))
      .attr("y2", ys(1))
      .attr("stroke", "#1f2733")
      .attr("stroke-dasharray", "4 3");
    sel
      .append("text")
      .attr("x", xs(1) - 8)
      .attr("y", ys(1) + 14)
      .attr("text-anchor", "end")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("perfect calibration");

    const line = d3
      .line<{ p: number; e: number }>()
      .x((d) => xs(d.p))
      .y((d) => ys(d.e))
      .curve(d3.curveCatmullRom);

    // Raw line
    const rawPath = sel
      .append("path")
      .datum(RAW)
      .attr("fill", "none")
      .attr("stroke", "#fbbf24")
      .attr("stroke-width", 2)
      .attr("d", line as never);
    const rawLen = (rawPath.node() as SVGPathElement).getTotalLength();
    rawPath
      .attr("stroke-dasharray", `${rawLen} ${rawLen}`)
      .attr("stroke-dashoffset", rawLen)
      .transition()
      .duration(1200)
      .attr("stroke-dashoffset", 0);

    // Calibrated line
    const calPath = sel
      .append("path")
      .datum(CAL)
      .attr("fill", "none")
      .attr("stroke", "#34d399")
      .attr("stroke-width", 2.4)
      .attr("d", line as never);
    const calLen = (calPath.node() as SVGPathElement).getTotalLength();
    calPath
      .attr("stroke-dasharray", `${calLen} ${calLen}`)
      .attr("stroke-dashoffset", calLen)
      .transition()
      .duration(1500)
      .delay(400)
      .attr("stroke-dashoffset", 0);

    // Points
    sel
      .selectAll("circle.raw")
      .data(RAW)
      .enter()
      .append("circle")
      .attr("class", "raw")
      .attr("cx", (d) => xs(d.p))
      .attr("cy", (d) => ys(d.e))
      .attr("r", 0)
      .attr("fill", "#fbbf24")
      .transition()
      .delay((_, i) => i * 80)
      .attr("r", 3.4);

    sel
      .selectAll("circle.cal")
      .data(CAL)
      .enter()
      .append("circle")
      .attr("class", "cal")
      .attr("cx", (d) => xs(d.p))
      .attr("cy", (d) => ys(d.e))
      .attr("r", 0)
      .attr("fill", "#34d399")
      .transition()
      .delay((_, i) => 600 + i * 80)
      .attr("r", 3.6);

    // Histogram of bin sizes underneath
    const histY = H - padB + 16;
    const histH = 36;
    const maxN = d3.max(CAL, (d) => d.n) ?? 1;
    sel
      .selectAll("rect.hist")
      .data(CAL)
      .enter()
      .append("rect")
      .attr("class", "hist")
      .attr("x", (d) => xs(d.p) - 12)
      .attr("y", histY + histH)
      .attr("width", 24)
      .attr("height", 0)
      .attr("fill", "#3b82f6")
      .attr("fill-opacity", 0.5)
      .transition()
      .delay(1100)
      .duration(500)
      .attr("y", (d) => histY + histH - (d.n / maxN) * histH)
      .attr("height", (d) => (d.n / maxN) * histH);
    sel
      .append("text")
      .attr("x", padL)
      .attr("y", histY + histH + 14)
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("bin sizes (n samples per decile)");

    // Axes
    sel
      .append("g")
      .attr("transform", `translate(0,${H - padB})`)
      .call(d3.axisBottom(xs).ticks(5))
      .call((g) => {
        g.selectAll("path,line").attr("stroke", "#1f2733");
        g.selectAll("text").attr("fill", "#9aa6b8").attr("font-family", "ui-monospace, Menlo, monospace").attr("font-size", 10);
      });
    sel
      .append("g")
      .attr("transform", `translate(${padL},0)`)
      .call(d3.axisLeft(ys).ticks(5))
      .call((g) => {
        g.selectAll("path,line").attr("stroke", "#1f2733");
        g.selectAll("text").attr("fill", "#9aa6b8").attr("font-family", "ui-monospace, Menlo, monospace").attr("font-size", 10);
      });
    sel
      .append("text")
      .attr("x", W / 2)
      .attr("y", H - padB + 36)
      .attr("text-anchor", "middle")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("predicted probability of ≥ 1 claim");
    sel
      .append("text")
      .attr("transform", `translate(14,${H / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("empirical fraction with claim");

    // Legend
    const legend = sel.append("g").attr("transform", `translate(${W - padR - 200}, ${padT + 8})`);
    [
      { c: "#fbbf24", t: "raw XGB · ECE=0.041" },
      { c: "#34d399", t: "isotonic-calibrated · ECE=0.008" },
    ].forEach((it, i) => {
      legend.append("circle").attr("cx", 6).attr("cy", 6 + i * 18).attr("r", 4).attr("fill", it.c);
      legend
        .append("text")
        .attr("x", 16)
        .attr("y", 9 + i * 18)
        .attr("fill", "#9aa6b8")
        .attr("font-family", "ui-monospace, Menlo, monospace")
        .attr("font-size", 10)
        .text(it.t);
    });
  }, []);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Reliability diagram · XGBoost loss-freq · raw vs isotonic-calibrated
        </div>
      </div>
      <svg ref={ref} className="h-[380px] w-full" />
    </div>
  );
}
