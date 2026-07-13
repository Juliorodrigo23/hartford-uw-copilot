"use client";

/**
 * DataSourceMap — US choropleth of REAL NHTSA FARS fatal-crash counts by
 * state (fars_state_metrics.json, exported by script 08 --with-fars).
 * Renders a pending card until that export exists; never shows invented
 * state metrics.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import * as topojson from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { useData } from "@/lib/useData";
import { DataBadge, PendingCard } from "@/components/DataBadge";
import type { FarsStateMetrics } from "@/lib/api";

// us-atlas topojson from CDN; cached aggressively.
const US_TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

export function DataSourceMap() {
  const { data, status } = useData<FarsStateMetrics>("fars_state_metrics.json");
  const svgRef = useRef<SVGSVGElement>(null);
  const [topo, setTopo] = useState<FeatureCollection<Geometry, { name: string }> | null>(null);
  const [hover, setHover] = useState<{ name: string; n: number } | null>(null);

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
        ) as unknown as FeatureCollection<Geometry, { name: string }>;
        if (!cancelled) setTopo(fc);
      } catch {
        // Map outline unavailable; the pending/list view still renders.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(
    () => new Map((data?.states ?? []).map((s) => [s.id, s])),
    [data],
  );
  const maxN = useMemo(
    () => Math.max(1, ...(data?.states ?? []).map((s) => s.fatal_crashes)),
    [data],
  );
  const colorScale = useMemo(
    () =>
      d3
        .scaleSequential(d3.interpolateRgbBasis(["#1a2030", "#7f1d1d", "#dc2626", "#fbbf24"]))
        .domain([0, maxN]),
    [maxN],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !topo || !data) return;
    const sel = d3.select(svg);
    sel.selectAll("*").remove();
    const W = svg.clientWidth || 760;
    const H = svg.clientHeight || 420;
    sel.attr("viewBox", `0 0 ${W} ${H}`);

    const projection = d3.geoAlbersUsa().scale(W * 1.05).translate([W / 2, H / 2]);
    const path = d3.geoPath(projection);

    sel
      .append("g")
      .selectAll<SVGPathElement, (typeof topo.features)[number]>("path")
      .data(topo.features)
      .enter()
      .append("path")
      .attr("d", (d) => path(d) ?? "")
      .attr("fill", (d) => {
        const id = String((d as { id?: string | number }).id ?? "").padStart(2, "0");
        const m = byId.get(id);
        return m ? colorScale(m.fatal_crashes) : "#10141b";
      })
      .attr("stroke", "#1f2733")
      .attr("stroke-width", 0.6)
      .attr("fill-opacity", 0.9)
      .on("mousemove", (_e, d) => {
        const id = String((d as { id?: string | number }).id ?? "").padStart(2, "0");
        const m = byId.get(id);
        if (m) setHover({ name: m.name, n: m.fatal_crashes });
      })
      .on("mouseleave", () => setHover(null));

    // Legend
    const legend = sel.append("g").attr("transform", `translate(20, ${H - 36})`);
    legend
      .append("text")
      .attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace")
      .attr("font-size", 10)
      .text(`FARS fatal crashes · ${data.year}`);
    d3.range(0, 1.001, 0.05).forEach((s, i) => {
      legend
        .append("rect")
        .attr("x", i * 8)
        .attr("y", 8)
        .attr("width", 8)
        .attr("height", 8)
        .attr("fill", colorScale(s * maxN));
    });
    legend
      .append("text").attr("y", 28).attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace").attr("font-size", 9).text("0");
    legend
      .append("text").attr("y", 28).attr("x", 145).attr("fill", "#6c7689")
      .attr("font-family", "ui-monospace, Menlo, monospace").attr("font-size", 9)
      .text(String(maxN));
  }, [topo, data, byId, colorScale, maxN]);

  if (status === "loading") {
    return <div className="card p-6 text-sm text-ink-dim">loading state metrics…</div>;
  }
  if (status === "missing" || !data) {
    return (
      <PendingCard
        title="Real FARS state metrics not exported yet (requires NHTSA API access)."
        command="uv run python scripts/08_export_viz_data.py --with-fars"
      />
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          NHTSA FARS · fatal crashes by state · {data.year}
        </div>
        <DataBadge kind="live" note={data.source} />
        <div className="ml-auto h-5 font-mono text-2xs text-ink-muted">
          {hover ? `${hover.name}: ${hover.n.toLocaleString()} fatal crashes` : "hover a state"}
        </div>
      </div>
      <svg ref={svgRef} className="h-[420px] w-full" />
    </div>
  );
}
