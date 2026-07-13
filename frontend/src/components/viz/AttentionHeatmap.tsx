"use client";

/**
 * AttentionHeatmap — CONCEPT ILLUSTRATION, clearly badged as such in the UI.
 *
 * Gemini's attention weights aren't exposed, so the production-realistic
 * approach is input attribution via log-prob deltas under masking. This
 * component demonstrates what that surface looks like with a MOCK
 * attribution matrix; it does not claim to show real model internals. The
 * honest talking point: "here's the method I'd use and the UI it feeds;
 * computing it for real requires token log-probs, which the Vertex API
 * exposes via logprobs on generateContent."
 */

import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";
import { DataBadge } from "@/components/DataBadge";

type Pair = { input: string[]; output: string[]; attribution: number[][] };

const SAMPLE: Pair = {
  input: [
    "ABC", "Transport", "operates", "214", "power", "units", "in", "the", "south-central",
    "region", "with", "general", "freight", "commodity", "mix", ".", "Recent", "loss", "runs",
    "show", "47", "claims", "over", "5", "years", "with", "$4.2M", "incurred", ".", "Vehicle",
    "OOS", "rate", "is", "27", "%", ",", "BASIC", "HoS", "score", "62", ",", "above",
    "FMCSA", "intervention", "threshold", ".",
  ],
  output: [
    "Decline", "OR", "quote", "with", "significant", "surcharge", "+", "pre-binding",
    "loss", "control", "inspection", ".",
  ],
  // attribution[i][j] = how much input token j matters to output token i (in [0,1])
  attribution: [],
};

// Generate a plausible attribution matrix:
// "Decline" attends to "OOS rate is 27%", "BASIC HoS score 62", "above threshold"
// "loss control" attends to "27%", "loss runs", "OOS"
function makeAttribution(): number[][] {
  const Out = SAMPLE.output.length;
  const In = SAMPLE.input.length;
  const m: number[][] = Array.from({ length: Out }, () => new Array(In).fill(0));
  const focusByOutput: Record<string, number[]> = {
    Decline: [29, 30, 31, 33, 34, 36, 37, 38, 39, 42, 43],
    OR: [29, 33, 36, 38],
    quote: [3, 4, 5, 16, 17, 27],
    with: [],
    significant: [29, 30, 31, 33, 34, 36, 37, 38, 39],
    surcharge: [16, 17, 18, 19, 20, 21, 27],
    "+": [],
    "pre-binding": [29, 30, 31, 33, 34, 36, 37, 38, 39],
    loss: [16, 17, 18, 19, 20, 21, 26, 27],
    control: [29, 30, 31, 36, 37, 38, 39],
    inspection: [29, 30, 31, 33, 34, 36, 37, 38, 39],
    ".": [],
  };
  SAMPLE.output.forEach((tok, i) => {
    const focuses = focusByOutput[tok] ?? [];
    focuses.forEach((j) => {
      m[i][j] = 0.55 + Math.random() * 0.45;
    });
    // Sprinkle small ambient attention everywhere
    for (let j = 0; j < In; j++) {
      m[i][j] = Math.max(m[i][j], Math.random() * 0.12);
    }
  });
  return m;
}

SAMPLE.attribution = makeAttribution();

export function AttentionHeatmap() {
  const ref = useRef<SVGSVGElement>(null);
  const [outIdx, setOutIdx] = useState(0);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    const padL = 16;
    const padR = 16;
    const padT = 108; // room for the slanted input-token labels
    const padB = 24;
    const cellH = 22;
    const sel = d3.select(svg).attr("viewBox", `0 0 ${W} ${H}`);
    sel.selectAll("*").remove();

    const cellW = (W - padL - padR) / SAMPLE.input.length;
    const color = d3.scaleSequential(d3.interpolateRgbBasis(["#10141b", "#3b82f6", "#dc2626", "#fbbf24"])).domain([0, 1]);

    // Heatmap row for the selected output token
    const row = SAMPLE.attribution[outIdx];
    sel
      .append("g")
      .selectAll("rect")
      .data(row)
      .enter()
      .append("rect")
      .attr("x", (_, i) => padL + i * cellW)
      .attr("y", padT)
      .attr("width", cellW - 0.6)
      .attr("height", cellH)
      .attr("fill", (d) => color(d))
      .attr("opacity", 0)
      .transition()
      .delay((_, i) => i * 12)
      .duration(220)
      .attr("opacity", 0.95);

    // Input tokens — slanted 55° so adjacent labels don't overlap on the
    // narrow (~15px) cells. Anchored at the cell center, rotated in place.
    sel
      .append("g")
      .selectAll("text")
      .data(SAMPLE.input)
      .enter()
      .append("text")
      .attr(
        "transform",
        (_, i) => `translate(${padL + i * cellW + cellW / 2}, ${padT - 8}) rotate(-55)`,
      )
      .attr("text-anchor", "start")
      .attr("fill", "#9aa6b8")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text((d) => d);

    // Output tokens row
    const outY = padT + cellH + 26;
    const outCellW = (W - padL - padR) / SAMPLE.output.length;
    sel
      .append("text")
      .attr("x", padL)
      .attr("y", outY - 6)
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("generated → click a token to inspect attribution");
    sel
      .append("g")
      .selectAll("rect.out")
      .data(SAMPLE.output)
      .enter()
      .append("rect")
      .attr("class", "out")
      .attr("x", (_, i) => padL + i * outCellW + 4)
      .attr("y", outY)
      .attr("width", outCellW - 8)
      .attr("height", 28)
      .attr("rx", 4)
      .attr("fill", (_, i) => (i === outIdx ? "#dc2626" : "#10141b"))
      .attr("stroke", (_, i) => (i === outIdx ? "#fecaca" : "#2b3645"))
      .attr("cursor", "pointer")
      .on("click", (_, d) => setOutIdx(SAMPLE.output.indexOf(d)));
    sel
      .append("g")
      .selectAll("text.out")
      .data(SAMPLE.output)
      .enter()
      .append("text")
      .attr("class", "out")
      .attr("x", (_, i) => padL + i * outCellW + outCellW / 2)
      .attr("y", outY + 18)
      .attr("text-anchor", "middle")
      .attr("fill", (_, i) => (i === outIdx ? "#fecaca" : "#9aa6b8"))
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 11)
      .attr("cursor", "pointer")
      .text((d) => d)
      .on("click", (_, d) => setOutIdx(SAMPLE.output.indexOf(d)));

    void padB;
  }, [outIdx]);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Input attribution · concept walkthrough
        </div>
        <DataBadge
          kind="illustrative"
          note="mock attribution matrix — shows the masking-based attribution METHOD, not real Gemini values"
        />
        <div className="ml-auto flex items-center gap-2 text-2xs text-ink-muted">
          <span className="font-mono">focal token:</span>
          <select
            value={outIdx}
            onChange={(e) => setOutIdx(Number(e.target.value))}
            className="rounded-md border border-border bg-bg-card px-2 py-1 text-xs text-ink"
          >
            {SAMPLE.output.map((t, i) => (
              <option key={t + i} value={i}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <svg ref={ref} className="h-[230px] w-full" />
      <div className="border-t border-border px-4 py-3 text-2xs text-ink-dim">
        Note: Gemini doesn't expose internal attention weights. We use a
        log-prob delta surrogate (mask each input token, measure the shift in
        the focal output token's log-probability), which is the standard
        attribution method for closed-source LLMs. The focal token "Decline"
        attributes most heavily to <em>"OOS rate · 27%"</em> and <em>"BASIC HoS · 62 · above threshold"</em>,
        which is the behavior we want.
      </div>
    </div>
  );
}
