/**
 * OverviewMap — a static, scannable map of the system. Three columns.
 * Doesn't try to be flashy, this is the "what does this thing actually do"
 * card so an interviewer who only reads this knows what to expect.
 */
const COLUMNS: {
  title: string;
  badge: string;
  items: string[];
}[] = [
  {
    title: "Inputs",
    badge: "border-accent-500/40 bg-accent-500/10 text-accent-400",
    items: [
      "ACORD-style submission packet",
      "Broker cover email",
      "Loss run (5-yr)",
      "Driver MVR summary",
      "DOT number → SAFER lookup",
    ],
  },
  {
    title: "Reasoning",
    badge: "border-info-500/40 bg-info-500/10 text-info-400",
    items: [
      "LangGraph state machine (9 nodes)",
      "Hybrid RAG: BM25 + dense + RRF",
      "Cross-encoder rerank top-50 → top-10",
      "Self-critique loop, max 2 iterations",
      "Tool calls: SAFER lookup, loss calc, comparables, XGBoost",
    ],
  },
  {
    title: "Outputs",
    badge: "border-warn-500/40 bg-warn-500/10 text-warn-400",
    items: [
      "Underwriting memo (Markdown)",
      "Structured risk score + drivers",
      "Cited evidence (NTSB / 10-K / forms)",
      "Producer-facing summary",
      "Full LangGraph trace (replayable)",
    ],
  },
];

export function OverviewMap() {
  return (
    <div className="panel p-8">
      <div className="section-eyebrow">System at a glance</div>
      <h2 className="section-heading mt-2">Where data goes in, where decisions come out</h2>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {COLUMNS.map((c) => (
          <div key={c.title} className="card p-5">
            <div
              className={`mb-2 inline-block rounded border px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.18em] ${c.badge}`}
            >
              {c.title}
            </div>
            <ul className="mt-2 space-y-2 text-sm text-ink-muted">
              {c.items.map((it) => (
                <li key={it} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-dim" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
