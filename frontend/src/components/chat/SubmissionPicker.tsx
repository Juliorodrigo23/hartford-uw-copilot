"use client";

import { useData } from "@/lib/useData";
import { cn } from "@/lib/cn";
import { Loader2, Truck, TriangleAlert } from "lucide-react";

export type ChatSubmission = {
  id: string;
  carrier_name: string;
  dot_number: string;
  fleet_size: number;
  states_of_operation: string[];
  loss_summary: string;
  red_flags: string[];
};

export function SubmissionPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (sub: ChatSubmission) => void;
}) {
  const { data, status } = useData<{ submissions: ChatSubmission[] }>("submissions_index.json");
  const subs = data?.submissions ?? [];

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Truck size={14} className="text-ink-dim" />
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Synthesized submissions{status === "live" ? ` · ${subs.length}` : ""}
        </div>
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2 px-1 py-6 text-xs text-ink-dim">
          <Loader2 size={12} className="animate-spin" /> loading submissions…
        </div>
      )}

      {status === "missing" && (
        <div className="flex items-start gap-2 rounded-md border border-warn-500/40 bg-warn-500/10 px-2 py-2 text-xs text-warn-400">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <span>
            submissions_index.json not found. Run{" "}
            <code className="font-mono">scripts/08_export_viz_data.py</code> in the backend
            and redeploy the frontend data folder.
          </span>
        </div>
      )}

      <div className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
        {subs.map((s) => {
          const sel = selectedId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left text-xs transition-colors",
                sel
                  ? "border-brand-500/60 bg-brand-700/15"
                  : "border-border bg-bg-card hover:border-border-strong",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{s.carrier_name}</span>
                <span className="font-mono text-2xs text-ink-dim">{s.id}</span>
              </div>
              <div className="mt-0.5 font-mono text-2xs text-ink-dim">
                DOT {s.dot_number} · {s.fleet_size} PUs · {s.states_of_operation.join("/")}
              </div>
              <div className="mt-1 text-ink-muted">{s.loss_summary}</div>
              {s.red_flags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.red_flags.map((f) => (
                    <span
                      key={f}
                      className="rounded border border-warn-500/40 bg-warn-500/10 px-1.5 py-0.5 font-mono text-[10px] text-warn-400"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {status === "live" && (
        <div className="mt-2 font-mono text-2xs text-ink-dim">
          every DOT verified against FMCSA SAFER at synthesis time
        </div>
      )}
    </div>
  );
}
