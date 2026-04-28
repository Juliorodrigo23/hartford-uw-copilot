"use client";

import { Sparkles } from "lucide-react";

const PROMPTS: { label: string; prompt: string }[] = [
  {
    label: "Triage",
    prompt: "Triage this submission. Surface the top 3 risk drivers, recommend a disposition, and cite your evidence.",
  },
  {
    label: "Red flags",
    prompt: "What are the most material red flags on this account? Include any BASIC violations and explain why each matters.",
  },
  {
    label: "Producer summary",
    prompt: "Write a producer-facing risk summary for this submission, suitable to send back to the broker. Keep it under 200 words.",
  },
  {
    label: "Pricing rationale",
    prompt: "Given the loss history and SAFER profile, what surcharge range would you support, and what would you require for the lower end?",
  },
];

export function SuggestedPrompts({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PROMPTS.map((p) => (
        <button
          key={p.label}
          onClick={() => onPick(p.prompt)}
          className="flex items-center gap-1.5 rounded-full border border-border bg-bg-card px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
        >
          <Sparkles size={11} className="text-brand-400" />
          {p.label}
        </button>
      ))}
    </div>
  );
}
