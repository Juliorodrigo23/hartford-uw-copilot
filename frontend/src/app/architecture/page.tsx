import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Database,
  FileSearch,
  GitBranch,
  Play,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import {
  ArchitectureExplorer,
  HitlTruthCard,
  RagLifecycle,
} from "@/components/architecture/ArchitectureExplorer";
import { TechnicalDeepDive } from "@/components/architecture/TechnicalDeepDive";

export default function ArchitecturePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-bg-panel/75 p-7 md:p-10">
        <div className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full bg-info-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/4 h-80 w-80 rounded-full bg-brand-700/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_.75fr] lg:items-end">
          <div>
            <div className="section-eyebrow">Architecture &amp; Pipeline Completeness</div>
            <h1 className="mt-3 max-w-4xl text-balance text-4xl font-semibold leading-tight tracking-[-0.03em] md:text-5xl">
              Every decision path, state patch, and recovery loop—visible.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-ink-muted">
              This is the executable topology in <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-xs text-ink">builder.py</code>, not a conceptual reference architecture.
              Select a node to inspect its state contract, or replay the recorded sample to watch the critic trigger a complete evidence repair cycle.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link href="/chat?demo=SUB-001&replay=1" className="btn-primary group px-4 py-2.5">
              <Play size={15} fill="currentColor" /> Replay sample case <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/pipeline" className="btn-secondary px-4 py-2.5"><FileSearch size={15} /> Inspect evidence pipeline</Link>
          </div>
        </div>

        <div className="relative mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          <HeroMetric icon={GitBranch} value="9 nodes" label="one compiled StateGraph" />
          <HeroMetric icon={ShieldCheck} value="2 routers" label="safety + quality gates" />
          <HeroMetric icon={Database} value="29 fields" label="typed shared AgentState" />
          <HeroMetric icon={Clock3} value="13 steps" label="recorded repair trace" />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="graph-heading">
        <SectionHeading
          id="graph-heading"
          eyebrow="01 · EXECUTABLE GRAPH"
          title="Nine nodes. Two conditional routers. One bounded repair loop."
          description="The animated case follows the saved SUB-001 run. The missing-DOT replay exercises the graph's alternate terminal branch. Click any node for its reads, writes, and failure contract."
        />
        <div className="mt-5"><ArchitectureExplorer /></div>
      </section>

      <section className="mt-12" aria-labelledby="rag-heading">
        <SectionHeading
          id="rag-heading"
          eyebrow="02 · EVIDENCE LIFECYCLE"
          title="Retrieval is a staged, identity-preserving pipeline."
          description="Dense and lexical candidates disagree by design. Reciprocal rank fusion reconciles them, the cross-encoder reranks the fused pool, and the critic can reopen retrieval with a gap-specific query."
        />
        <div className="mt-5"><RagLifecycle /></div>
      </section>

      <section className="mt-12" aria-labelledby="hitl-heading">
        <SectionHeading
          id="hitl-heading"
          eyebrow="03 · HUMAN OVERSIGHT"
          title="Checkpointing, handoff, and native HITL are labeled separately."
          description="A production architecture review should make implemented controls and roadmap gaps equally clear. These are the controls that exist in the current graph."
        />
        <div className="mt-5"><HitlTruthCard /></div>
      </section>

      <section id="case-study" className="mt-12 scroll-mt-24" aria-labelledby="case-heading">
        <SectionHeading
          id="case-heading"
          eyebrow="04 · SAMPLE POLICY CASE STUDY"
          title="The critic changed the path—not just the score."
          description="SUB-001 is a synthetic commercial-auto packet bound to a verified public DOT profile. The numbers below are frozen from the recorded showcase artifact so a reviewer can inspect the experience without waiting for model inference."
        />
        <div className="mt-5 overflow-hidden rounded-xl border border-border bg-bg-card">
          <div className="grid lg:grid-cols-[.8fr_1.2fr]">
            <div className="border-b border-border p-6 lg:border-b-0 lg:border-r lg:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-2xs uppercase tracking-[.16em] text-ink-dim">Recorded input · SUB-001</div>
                  <h3 className="mt-2 text-xl font-semibold">ABC Transport Inc.</h3>
                  <p className="mt-1 font-mono text-2xs text-ink-dim">synthetic alias · DOT evidence verified at synthesis time</p>
                </div>
                <span className="rounded-full border border-brand-500/40 bg-brand-700/15 px-2.5 py-1 font-mono text-2xs font-semibold uppercase text-brand-400">decline · 95%</span>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <CaseMetric value="619" label="submitted power units" />
                <CaseMetric value="207" label="claims across 5 years" />
                <CaseMetric value="$23.9M" label="recorded incurred loss" />
                <CaseMetric value="15" label="retrieved cited chunks" />
              </div>

              <div className="mt-6 rounded-lg border border-border bg-bg-panel p-4">
                <div className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[.14em] text-info-400"><BookOpenCheck size={14} /> decision package</div>
                <ul className="mt-3 space-y-2 text-xs text-ink-muted">
                  <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-accent-400" /> cited underwriting memo</li>
                  <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-accent-400" /> typed disposition + confidence + drivers</li>
                  <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-accent-400" /> producer summary + complete tool trace</li>
                </ul>
              </div>
            </div>

            <div className="p-6 lg:p-7">
              <div className="font-mono text-2xs uppercase tracking-[.16em] text-ink-dim">Why the run took 13 transitions</div>
              <div className="mt-5 space-y-0">
                <TimelineItem icon={Sparkles} tone="text-info-400 border-info-500/35 bg-info-500/10" title="Draft 01 assembled the case" meta="T+46.82s" body="SAFER enrichment, 10 retrieved chunks, loss features, XGBoost output, and five comparable accounts became a structured first memo." />
                <TimelineItem icon={ShieldCheck} tone="text-warn-400 border-warn-500/35 bg-warn-500/10" title="The critic rejected the draft" meta="T+48.52s" body="GPT-4o returned four evidence and completeness gaps. critique_pass=false routed the state back to retrieve_context." />
                <TimelineItem icon={GitBranch} tone="text-accent-400 border-accent-500/35 bg-accent-500/10" title="The entire evidence chain repaired" meta="T+50.85s" body="Retrieval expanded with the gaps, merged five new chunks, then loss analysis, comparable search, and memo generation reran on the updated state." />
                <TimelineItem icon={UserCheck} tone="text-brand-400 border-brand-500/35 bg-brand-700/10" title="A supervised decision package finalized" meta="T+88.35s" body="The bounded second critique completed and the graph emitted a typed package. It remains decision support at the human underwriting boundary." last />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/chat?demo=SUB-001&replay=1" className="btn-primary"><Play size={14} /> Replay this case in the analyzer</Link>
                <Link href="/pipeline#evaluation" className="btn-secondary">See evaluation evidence <ArrowRight size={14} /></Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="deep-dive-heading">
        <SectionHeading
          id="deep-dive-heading"
          eyebrow="05 · TECHNICAL DEEP DIVE"
          title="Open the system contract layer by layer."
          description="The values here come from the current backend defaults and recorded showcase trace: state fields, chunking parameters, retrieval budgets, latency, failure policies, and ablation switches."
        />
        <div className="mt-5"><TechnicalDeepDive /></div>
      </section>
    </div>
  );
}

function SectionHeading({ id, eyebrow, title, description }: { id: string; eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <div className="section-eyebrow">{eyebrow}</div>
      <h2 id={id} className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-ink-muted">{description}</p>
    </div>
  );
}

function HeroMetric({ icon: Icon, value, label }: { icon: typeof GitBranch; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 bg-bg-card/85 p-4">
      <span className="rounded-md border border-border bg-bg p-2 text-brand-400"><Icon size={16} /></span>
      <div><div className="font-mono text-sm font-semibold text-ink">{value}</div><div className="mt-0.5 text-[11px] text-ink-dim">{label}</div></div>
    </div>
  );
}

function CaseMetric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-lg border border-border bg-bg-panel p-3"><div className="font-mono text-xl font-semibold text-ink">{value}</div><div className="mt-1 text-[11px] text-ink-dim">{label}</div></div>;
}

function TimelineItem({ icon: Icon, tone, title, meta, body, last = false }: { icon: typeof Sparkles; tone: string; title: string; meta: string; body: string; last?: boolean }) {
  return (
    <div className="grid grid-cols-[34px_1fr] gap-3">
      <div className="relative flex justify-center">
        <span className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border ${tone}`}><Icon size={14} /></span>
        {!last && <span className="absolute bottom-0 top-8 w-px bg-border-strong" />}
      </div>
      <div className={last ? "pb-0" : "pb-5"}>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-semibold">{title}</h4><span className="font-mono text-[10px] text-ink-dim">{meta}</span></div>
        <p className="mt-1.5 text-xs leading-5 text-ink-muted">{body}</p>
      </div>
    </div>
  );
}
