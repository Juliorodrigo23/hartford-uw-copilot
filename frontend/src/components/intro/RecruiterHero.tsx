import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Braces,
  Clock3,
  GitBranch,
  Play,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const METRICS = [
  {
    value: "9",
    label: "orchestrated agent nodes",
    detail: "2 conditional routes",
    icon: GitBranch,
    tone: "text-info-400 bg-info-500/10 border-info-500/30",
  },
  {
    value: "50 → 10",
    label: "RAG rerank funnel",
    detail: "dense + BM25 + RRF",
    icon: SearchCheck,
    tone: "text-accent-400 bg-accent-500/10 border-accent-500/30",
  },
  {
    value: "2× max",
    label: "critic repair passes",
    detail: "cross-family judge",
    icon: ShieldCheck,
    tone: "text-warn-400 bg-warn-500/10 border-warn-500/30",
  },
  {
    value: "88.3s",
    label: "recorded case trace",
    detail: "13 node transitions",
    icon: Clock3,
    tone: "text-brand-400 bg-brand-700/10 border-brand-500/30",
  },
];

export function RecruiterHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-bg-panel/80 shadow-2xl shadow-black/20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(220,38,38,0.16),transparent_28%),radial-gradient(circle_at_16%_80%,rgba(16,185,129,0.08),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] [background-size:44px_44px]" />

      <div className="relative grid gap-8 p-7 md:p-10 lg:grid-cols-[1.15fr_.85fr] lg:p-12">
        <div className="flex flex-col justify-center">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-500/30 bg-accent-500/10 px-3 py-1 font-mono text-2xs uppercase tracking-[0.16em] text-accent-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />
              Production-shaped GenAI portfolio
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-bg/50 px-3 py-1 font-mono text-2xs text-ink-muted">
              <BadgeCheck size={12} className="text-info-400" /> supervised decisions
            </span>
          </div>

          <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.035em] md:text-5xl lg:text-[3.45rem]">
            From submission packet to a cited underwriting decision—
            <span className="text-ink-muted">in one observable agent run.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted md:text-lg">
            The copilot gathers carrier evidence, models loss risk, retrieves and reranks supporting context,
            drafts a memo, and sends weak answers back through a critic loop. An underwriter stays at the
            decision boundary.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/chat?demo=SUB-001&replay=1" className="btn-primary group px-4 py-2.5">
              <Play size={15} fill="currentColor" />
              Replay the sample policy case
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/architecture" className="btn-secondary px-4 py-2.5">
              <Braces size={15} /> Inspect the architecture
            </Link>
          </div>

          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 font-mono text-2xs text-ink-dim">
            <span className="flex items-center gap-1.5"><Sparkles size={12} /> Gemini 3.8 Flash</span>
            <span className="flex items-center gap-1.5"><GitBranch size={12} /> LangGraph + checkpoints</span>
            <span className="flex items-center gap-1.5"><SearchCheck size={12} /> hybrid RAG</span>
          </div>
        </div>

        <SampleCaseCard />
      </div>

      <div className="relative grid grid-cols-2 border-t border-border md:grid-cols-4">
        {METRICS.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className={`p-4 md:p-5 ${index % 2 ? "border-l border-border" : ""} ${index > 1 ? "border-t border-border md:border-t-0" : ""} ${index > 0 ? "md:border-l" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xl font-semibold tracking-tight text-ink md:text-2xl">{metric.value}</div>
                  <div className="mt-1 text-xs font-medium text-ink-muted md:text-sm">{metric.label}</div>
                  <div className="mt-1 font-mono text-[10px] text-ink-dim">{metric.detail}</div>
                </div>
                <span className={`rounded-md border p-2 ${metric.tone}`}><Icon size={15} /></span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SampleCaseCard() {
  return (
    <div className="relative self-center rounded-xl border border-border-strong bg-bg/85 p-1 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="rounded-lg border border-border bg-bg-card/80 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">Sample case · SUB-001</div>
            <div className="mt-1 text-lg font-semibold">ABC Transport Inc.</div>
            <div className="mt-1 font-mono text-2xs text-ink-dim">synthetic alias · verified FMCSA profile</div>
          </div>
          <span className="rounded-full border border-brand-500/40 bg-brand-700/15 px-2.5 py-1 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-brand-400">
            decline · 95%
          </span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <CaseStat value="619" label="submitted PUs" />
          <CaseStat value="207" label="5-year claims" />
          <CaseStat value="15" label="cited chunks" />
        </div>

        <div className="mt-5 space-y-2.5">
          <FlowRow index="01" label="Evidence gathered" value="SAFER · NTSB · SEC" tone="text-accent-400" />
          <FlowRow index="02" label="Risk modeled" value="XGBoost + comparables" tone="text-info-400" />
          <FlowRow index="03" label="Memo challenged" value="critic found 4 gaps" tone="text-warn-400" />
          <FlowRow index="04" label="Decision package" value="15 citations · trace saved" tone="text-brand-400" />
        </div>

        <Link
          href="/architecture#case-study"
          className="mt-5 flex items-center justify-between rounded-md border border-border bg-bg-panel px-3 py-2 text-xs text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
        >
          <span>See why the agent looped before finalizing</span>
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function CaseStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-panel/70 p-2.5">
      <div className="font-mono text-sm font-semibold text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] leading-4 text-ink-dim">{label}</div>
    </div>
  );
}

function FlowRow({ index, label, value, tone }: { index: string; label: string; value: string; tone: string }) {
  return (
    <div className="grid grid-cols-[24px_1fr_auto] items-center gap-2 text-xs">
      <span className={`font-mono text-2xs ${tone}`}>{index}</span>
      <span className="text-ink-muted">{label}</span>
      <span className="font-mono text-2xs text-ink">{value}</span>
    </div>
  );
}
