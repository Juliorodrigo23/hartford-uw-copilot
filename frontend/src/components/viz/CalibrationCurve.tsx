"use client";

/**
 * CalibrationCurve — reliability diagram for the loss-frequency model,
 * rendered from REAL out-of-fold calibration bins in model_insights.json
 * (script 06 computes them, script 08 exports them). Pre-isotonic vs
 * post-isotonic, with per-decile bin sizes underneath.
 */

import * as d3 from "d3";
import { useEffect, useRef } from "react";
import { useData } from "@/lib/useData";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { ModelInsights } from "@/lib/api";

export function CalibrationCurve() {
  const { data, status } = useData<ModelInsights>("model_insights.json");
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !data) return;
    const RAW = data.calibration.raw;
    const CAL = data.calibration.calibrated;
    if (!RAW.length || !CAL.length) return;

    const W = svg.clientWidth || 700;
    const H = svg.clientHeight || 380;
    const padL = 50,
      padR = 16,
      padT = 14,
      padB = 70;
    const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`);
    sel.selectAll("*").remove();

    const lo = Math.min(RAW[0].p, RAW[0].e, CAL[0].p, CAL[0].e);
    const xs = d3.scaleLinear().domain([Math.max(0, lo - 0.02), 1]).range([padL, W - padR]);
    const ys = d3.scaleLinear().domain([Math.max(0, lo - 0.02), 1]).range([H - padB, padT]);

    // Diagonal
    sel
      .append("line")
      .attr("x1", xs.range()[0])
      .attr("y1", ys.range()[0])
      .attr("x2", xs.range()[1])
      .attr("y2", ys.range()[1])
      .attr("stroke", "#1f2733")
      .attr("stroke-dasharray", "4 3");
    sel
      .append("text")
      .attr("x", xs.range()[1] - 8)
      .attr("y", ys.range()[1] + 14)
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

    for (const [series, color, delay] of [
      [RAW, "#fbbf24", 0],
      [CAL, "#34d399", 400],
    ] as const) {
      const path = sel
        .append("path")
        .datum(series as { p: number; e: number }[])
        .attr("fill", "none")
        .attr("stroke", color as string)
        .attr("stroke-width", 2.2)
        .attr("d", line as never);
      const len = (path.node() as SVGPathElement).getTotalLength();
      path
        .attr("stroke-dasharray", `${len} ${len}`)
        .attr("stroke-dashoffset", len)
        .transition()
        .duration(1200)
        .delay(delay as number)
        .attr("stroke-dashoffset", 0);
      sel
        .selectAll(`circle.s${delay}`)
        .data(series as { p: number; e: number }[])
        .enter()
        .append("circle")
        .attr("cx", (d) => xs(d.p))
        .attr("cy", (d) => ys(d.e))
        .attr("r", 0)
        .attr("fill", color as string)
        .transition()
        .delay((_, i) => (delay as number) + i * 80)
        .attr("r", 3.4);
    }

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
      .attr("x", (d) => xs(d.p) - 10)
      .attr("y", histY + histH)
      .attr("width", 20)
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
      .text("bin sizes (n carriers per decile)");

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
      .text("predicted P(adverse frequency)");
    sel
      .append("text")
      .attr("transform", `translate(14,${H / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("empirical adverse fraction");

    // Legend with REAL Brier scores
    const legend = sel.append("g").attr("transform", `translate(${W - padR - 260}, ${padT + 8})`);
    [
      { c: "#fbbf24", t: `raw XGB · Brier ${data.calibration.brier_raw.toFixed(4)}` },
      { c: "#34d399", t: `isotonic-calibrated · Brier ${data.calibration.brier_calibrated.toFixed(4)}` },
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
  }, [data]);

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading calibration…</div>;
  }
  if (status === "missing" || !data) {
    return (
      <PendingCard
        title="Calibration data not exported yet."
        command="uv run python scripts/06_train_xgb.py && uv run python scripts/08_export_viz_data.py"
      />
    );
  }

  return (
    <div className="card overflow-hidden">
      <p className="border-b border-border p-3 text-xs text-amber-300">Base-model predictions are out of fold, but the calibrated curve is evaluated on the rows used to fit the calibrator. Treat it as an optimistic diagnostic until independent calibration evaluation is completed.</p>
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Historical reliability diagnostic · raw vs isotonic-calibrated
        </div>
        <DataBadge kind="live" note={`${data.version} · historical synthetic training export`} />
      </div>
      <svg ref={ref} className="h-[380px] w-full" />
    </div>
  );
}
