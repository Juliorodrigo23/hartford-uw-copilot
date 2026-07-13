"use client";

/**
 * ShowcaseBanner — surfaces the captured VERIFIED end-to-end run
 * (scripts/09_capture_showcase.py) at the top of the agent section, with a
 * link to the raw machine-readable trace. Renders nothing until a showcase
 * exists, so it can never advertise a run that didn't happen.
 */

import { BadgeCheck, FileJson } from "lucide-react";
import { useData } from "@/lib/useData";
import { dataPath } from "@/lib/api";
import type { ShowcaseRun } from "@/lib/api";

export function ShowcaseBanner() {
  const { data, status } = useData<ShowcaseRun>("showcase_run.json");
  if (status !== "live" || !data) return null;

  const secs = (data.total_ms / 1000).toFixed(1);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent-500/40 bg-accent-500/8 px-4 py-3">
      <span className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.2em] text-accent-400">
        <BadgeCheck size={14} /> verified end-to-end run
      </span>
      <span className="text-sm text-ink">
        {data.submission.id} · DOT {data.submission.dot_number}
        {data.submission.safer_legal_name ? ` (${data.submission.safer_legal_name})` : ""} ·{" "}
        {data.retrieved_count} chunks retrieved · {data.drafts.length}{" "}
        {data.drafts.length === 1 ? "draft" : "drafts"} · {secs}s wall time ·{" "}
        {data.generated_at.slice(0, 10)}
      </span>
      <span className="ml-auto flex items-center gap-3 text-xs">
        <span className="text-ink-muted">
          The tool calls and critique below are THIS run's real data.
        </span>
        <a
          href={dataPath("showcase_run.json")}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded-md border border-border bg-bg-card px-2 py-1 font-mono text-2xs text-ink hover:border-border-strong"
        >
          <FileJson size={12} /> raw trace (LangGraph state)
        </a>
      </span>
    </div>
  );
}
