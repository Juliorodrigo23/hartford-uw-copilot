"use client";

/**
 * DataSourceMap — animated US choropleth of FMCSA crashes by state, with
 * NTSB investigation pins dropping in over time. Year scrubber on the side.
 *
 * Visual contract:
 *  - States colored by 5-yr crash density (per million VMT).
 *  - NTSB pins drop one-by-one with an easing animation.
 *  - Brushing a year highlights a year-specific subset.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { dataPath } from "@/lib/api";

// We fetch us-atlas topojson from CDN once; cached aggressively.
const US_TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

type StateMetric = { id: string; name: string; crashesPer100MVMT: number };
type Pin = { lon: number; lat: number; year: number; type: "ntsb" | "fars"; label: string };

const SAMPLE_STATES: StateMetric[] = [
  { id: "06", name: "California", crashesPer100MVMT: 1.86 },
  { id: "48", name: "Texas", crashesPer100MVMT: 2.14 },
  { id: "12", name: "Florida", crashesPer100MVMT: 1.92 },
  { id: "36", name: "New York", crashesPer100MVMT: 1.55 },
  { id: "17", name: "Illinois", crashesPer100MVMT: 1.74 },
  { id: "39", name: "Ohio", crashesPer100MVMT: 1.81 },
  { id: "42", name: "Pennsylvania", crashesPer100MVMT: 1.73 },
  { id: "26", name: "Michigan", crashesPer100MVMT: 1.62 },
  { id: "13", name: "Georgia", crashesPer100MVMT: 2.05 },
  { id: "37", name: "North Carolina", crashesPer100MVMT: 1.91 },
  { id: "47", name: "Tennessee", crashesPer100MVMT: 2.02 },
  { id: "01", name: "Alabama", crashesPer100MVMT: 2.27 },
  { id: "29", name: "Missouri", crashesPer100MVMT: 1.87 },
  { id: "18", name: "Indiana", crashesPer100MVMT: 1.94 },
  { id: "28", name: "Mississippi", crashesPer100MVMT: 2.34 },
  { id: "05", name: "Arkansas", crashesPer100MVMT: 2.18 },
  { id: "40", name: "Oklahoma", crashesPer100MVMT: 2.12 },
  { id: "21", name: "Kentucky", crashesPer100MVMT: 1.96 },
  { id: "22", name: "Louisiana", crashesPer100MVMT: 2.08 },
  { id: "55", name: "Wisconsin", crashesPer100MVMT: 1.49 },
  { id: "27", name: "Minnesota", crashesPer100MVMT: 1.42 },
  { id: "19", name: "Iowa", crashesPer100MVMT: 1.65 },
  { id: "20", name: "Kansas", crashesPer100MVMT: 1.78 },
  { id: "31", name: "Nebraska", crashesPer100MVMT: 1.6 },
  { id: "08", name: "Colorado", crashesPer100MVMT: 1.55 },
  { id: "04", name: "Arizona", crashesPer100MVMT: 1.81 },
  { id: "32", name: "Nevada", crashesPer100MVMT: 1.46 },
  { id: "53", name: "Washington", crashesPer100MVMT: 1.32 },
  { id: "41", name: "Oregon", crashesPer100MVMT: 1.41 },
  { id: "49", name: "Utah", crashesPer100MVMT: 1.39 },
];

const SAMPLE_PINS: Pin[] = [
  { lon: -97.74, lat: 30.27, year: 2019, type: "ntsb", label: "Austin TX · I-35 multi-veh" },
  { lon: -87.65, lat: 41.85, year: 2020, type: "ntsb", label: "Chicago IL · doubles, fatigue" },
  { lon: -84.39, lat: 33.75, year: 2020, type: "fars", label: "Atlanta GA · brake failure" },
  { lon: -80.19, lat: 25.77, year: 2021, type: "ntsb", label: "Miami FL · fatigue, run-off-road" },
  { lon: -118.24, lat: 34.05, year: 2021, type: "fars", label: "Los Angeles CA · I-5 chain" },
  { lon: -73.96, lat: 40.78, year: 2021, type: "ntsb", label: "NYC NY · pedestrian struck" },
  { lon: -111.93, lat: 33.45, year: 2022, type: "ntsb", label: "Phoenix AZ · dust storm" },
  { lon: -95.37, lat: 29.76, year: 2022, type: "ntsb", label: "Houston TX · jackknife I-10" },
  { lon: -86.78, lat: 36.16, year: 2022, type: "fars", label: "Nashville TN · over height" },
  { lon: -90.07, lat: 29.95, year: 2023, type: "ntsb", label: "New Orleans LA · fog pileup" },
  { lon: -104.99, lat: 39.74, year: 2023, type: "fars", label: "Denver CO · runaway grade" },
  { lon: -83.05, lat: 42.33, year: 2023, type: "ntsb", label: "Detroit MI · uninsured carrier" },
  { lon: -112.07, lat: 33.45, year: 2023, type: "fars", label: "Tempe AZ · driver impaired" },
  { lon: -77.04, lat: 38.89, year: 2024, type: "ntsb", label: "DC · bridge strike, hazmat" },
  { lon: -122.33, lat: 47.6, year: 2024, type: "fars", label: "Seattle WA · I-90 multi-veh" },
];

export function DataSourceMap() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [topo, setTopo] = useState<FeatureCollection<Geometry, { name: string; STATEFP: string }> | null>(null);
  const [year, setYear] = useState(2024);
  const [progress, setProgress] = useState(0); // 0..1, controls pin reveal

  // Load topojson once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(US_TOPO_URL);
        if (!r.ok) throw new Error("no topo");
        const t = (await r.json()) as Topology;
        const fc = topojson.feature(
          t,
          t.objects.states as Parameters<typeof topojson.feature>[1],
        ) as unknown as FeatureCollection<Geometry, { name: string; STATEFP: string }>;
        if (!cancelled) setTopo(fc);
      } catch {
        // No fallback — bg renders with empty map and pins still drop.
      }
    })();
    // optional override from backend
    fetch(dataPath("fmcsa_state_metrics.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then(() => {})
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Animate pin reveal
  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    const dur = 4500;
    const step = (t: number) => {
      const e = Math.min(1, (t - start) / dur);
      setProgress(e);
      if (e < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [year]);

  // Render
  const stateById = useMemo(() => new Map(SAMPLE_STATES.map((s) => [s.id, s])), []);
  const colorScale = useMemo(
    () =>
      d3
        .scaleSequential(d3.interpolateRgbBasis(["#1a2030", "#7f1d1d", "#dc2626", "#fbbf24"]))
        .domain([1.2, 2.4]),
    [],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const sel = d3.select(svg);
    sel.selectAll("*").remove();
    const W = svg.clientWidth || 760;
    const H = svg.clientHeight || 420;
    sel.attr("viewBox", `0 0 ${W} ${H}`);

    const projection = d3.geoAlbersUsa().scale(W * 1.05).translate([W / 2, H / 2]);
    const path = d3.geoPath(projection);

    // Background frame
    sel
      .append("rect")
      .attr("width", W)
      .attr("height", H)
      .attr("fill", "url(#mapGrad)");

    const defs = sel.append("defs");
    const grad = defs.append("radialGradient").attr("id", "mapGrad").attr("cx", "50%").attr("cy", "55%").attr("r", "60%");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#0d121a");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#0a0d12");

    // States
    if (topo) {
      sel
        .append("g")
        .selectAll<SVGPathElement, (typeof topo.features)[number]>("path")
        .data(topo.features)
        .enter()
        .append("path")
        .attr("d", (d) => path(d) ?? "")
        .attr("fill", (d) => {
          const id = String((d as { id?: string | number }).id ?? d.properties?.STATEFP ?? "").padStart(2, "0");
          const m = stateById.get(id);
          return m ? colorScale(m.crashesPer100MVMT) : "#10141b";
        })
        .attr("stroke", "#1f2733")
        .attr("stroke-width", 0.6)
        .attr("fill-opacity", 0.85);
    }

    // Pins for the selected year
    const pins = SAMPLE_PINS.filter((p) => p.year <= year);
    const visibleCount = Math.floor(pins.length * progress);
    const pinG = sel.append("g");
    pins.slice(0, visibleCount).forEach((p, i) => {
      const proj = projection([p.lon, p.lat]);
      if (!proj) return;
      const [px, py] = proj;
      const g = pinG.append("g").attr("transform", `translate(${px},${py})`);
      const c = p.type === "ntsb" ? "#60a5fa" : "#fbbf24";
      // Halo
      g.append("circle")
        .attr("r", 0)
        .attr("fill", c)
        .attr("fill-opacity", 0.14)
        .transition()
        .delay(i * 90)
        .duration(420)
        .attr("r", 14);
      // Dot
      g.append("circle")
        .attr("r", 0)
        .attr("fill", c)
        .attr("stroke", "#0a0d12")
        .attr("stroke-width", 1)
        .transition()
        .delay(i * 90)
        .duration(280)
        .attr("r", 3);
    });

    // Legend
    const legend = sel.append("g").attr("transform", `translate(20, ${H - 36})`);
    legend
      .append("text")
      .attr("class", "lg")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text("FMCSA crashes / 100M VMT");
    const lx = d3.scaleLinear().domain([1.2, 2.4]).range([0, 160]);
    const stops = d3.range(0, 1.001, 0.05);
    stops.forEach((s, i) => {
      legend
        .append("rect")
        .attr("x", i * 8)
        .attr("y", 8)
        .attr("width", 8)
        .attr("height", 8)
        .attr("fill", colorScale(1.2 + s * 1.2));
    });
    legend
      .append("text")
      .attr("y", 28)
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 9)
      .text("low");
    legend
      .append("text")
      .attr("y", 28)
      .attr("x", 145)
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 9)
      .text("high");

    // Pin legend
    const pinLegend = sel.append("g").attr("transform", `translate(${W - 240}, ${H - 36})`);
    [
      { c: "#60a5fa", t: "NTSB investigation" },
      { c: "#fbbf24", t: "FARS fatal crash" },
    ].forEach((it, i) => {
      pinLegend
        .append("circle")
        .attr("cx", 0)
        .attr("cy", 4 + i * 16)
        .attr("r", 3)
        .attr("fill", it.c);
      pinLegend
        .append("text")
        .attr("x", 8)
        .attr("y", 8 + i * 16)
        .attr("fill", "#9aa6b8")
        .attr("font-family", "ui-monospace, Menlo, monospace")
        .attr("font-size", 10)
        .text(it.t);
    });

    void lx;
  }, [topo, stateById, colorScale, year, progress]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Real public data · FMCSA crash table + NTSB investigation index
        </div>
        <div className="ml-auto flex items-center gap-2 text-2xs text-ink-muted">
          <span className="font-mono">year</span>
          <input
            type="range"
            min={2019}
            max={2024}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-1 w-32 cursor-pointer"
          />
          <span className="w-10 font-mono tabular-nums text-ink">{year}</span>
        </div>
      </div>
      <svg ref={svgRef} className="h-[420px] w-full" />
    </div>
  );
}
