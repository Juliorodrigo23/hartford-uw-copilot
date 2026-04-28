"use client";

import { useEffect, useState } from "react";
import { dataPath } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ChevronDown, Truck } from "lucide-react";

export type ChatSubmission = {
  id: string;
  carrier_name: string;
  dot_number: string;
  fleet_size: number;
  states_of_operation: string[];
  loss_summary: string;
  red_flags: string[];
};

const FALLBACK: ChatSubmission[] = [
  {
    id: "SUB-001",
    carrier_name: "ABC Transport Inc",
    dot_number: "2839412",
    fleet_size: 214,
    states_of_operation: ["TX", "OK", "AR", "LA"],
    loss_summary: "5-yr · 47 claims · $4.2M incurred · trend +14.7%/yr",
    red_flags: ["Vehicle OOS 27%", "BASIC HoS above threshold"],
  },
  {
    id: "SUB-002",
    carrier_name: "Cascadia Freight Co",
    dot_number: "1184729",
    fleet_size: 96,
    states_of_operation: ["WA", "OR", "ID", "MT"],
    loss_summary: "5-yr · 18 claims · $1.1M incurred · stable",
    red_flags: [],
  },
  {
    id: "SUB-003",
    carrier_name: "Magnolia Tank Lines",
    dot_number: "3092714",
    fleet_size: 142,
    states_of_operation: ["MS", "AL", "GA", "FL"],
    loss_summary: "5-yr · 31 claims · $2.7M incurred · 1 hazmat fatal",
    red_flags: ["Hazmat", "1 fatal in window"],
  },
  {
    id: "SUB-004",
    carrier_name: "Heartland LTL Group",
    dot_number: "2455910",
    fleet_size: 308,
    states_of_operation: ["IA", "NE", "MO", "KS", "IL", "IN"],
    loss_summary: "5-yr · 62 claims · $5.4M incurred · trend +6.1%/yr",
    red_flags: ["Driver shortage references in MVR"],
  },
  {
    id: "SUB-005",
    carrier_name: "Liberty Auto Transport",
    dot_number: "1873456",
    fleet_size: 178,
    states_of_operation: ["NJ", "PA", "NY", "CT"],
    loss_summary: "5-yr · 24 claims · $1.6M incurred · stable",
    red_flags: ["3 violations in last 6 mo"],
  },
];

export function SubmissionPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (sub: ChatSubmission) => void;
}) {
  const [subs, setSubs] = useState<ChatSubmission[]>(FALLBACK);

  useEffect(() => {
    fetch(dataPath("submissions_index.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { submissions?: ChatSubmission[] } | null) => {
        if (d?.submissions?.length) setSubs(d.submissions);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Truck size={14} className="text-ink-dim" />
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          Synthesized submissions · {subs.length}
        </div>
      </div>
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
      <div className="mt-2 flex items-center justify-between font-mono text-2xs text-ink-dim">
        <span>each tied to a real DOT</span>
        <ChevronDown size={11} />
      </div>
    </div>
  );
}
