"use client";

/**
 * DataBadge — provenance label carried by every visualization.
 *
 *   live         — rendered from real exported pipeline data
 *   pending      — the export doesn't exist yet; shows what to run
 *   illustrative — a conceptual illustration, and says so
 */

import { CircleCheck, CircleDashed, Info } from "lucide-react";

export function DataBadge({
  kind,
  note,
}: {
  kind: "live" | "pending" | "illustrative";
  note?: string;
}) {
  if (kind === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-400">
        <CircleCheck size={10} /> live pipeline data{note ? ` · ${note}` : ""}
      </span>
    );
  }
  if (kind === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-warn-500/40 bg-warn-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warn-400">
        <CircleDashed size={10} /> pending{note ? ` · ${note}` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-bg-subtle/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-dim">
      <Info size={10} /> illustrative{note ? ` · ${note}` : ""}
    </span>
  );
}

export function PendingCard({ title, command }: { title: string; command: string }) {
  return (
    <div className="card flex flex-col items-start gap-2 border-dashed p-4">
      <DataBadge kind="pending" />
      <div className="text-sm text-ink-muted">{title}</div>
      <code className="rounded bg-bg-subtle/60 px-2 py-1 font-mono text-xs text-ink">
        {command}
      </code>
    </div>
  );
}
