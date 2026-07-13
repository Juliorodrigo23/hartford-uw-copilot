import Link from "next/link";
import { ArrowRight, FileCode2, MessagesSquare } from "lucide-react";
import { RotatingInsuranceProvider } from "@/components/RotatingInsuranceProvider";

export function AboutMe() {
  return (
    <div className="panel relative overflow-hidden p-8 md:p-10">
      <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-700/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-accent-500/10 blur-3xl" />

      <div className="relative grid grid-cols-1 gap-8 md:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="section-eyebrow mb-3">
            Portfolio · GenAI Data Scientist · GD08AE
          </div>
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            A working underwriting copilot for <RotatingInsuranceProvider /> —
            <span className="text-ink-muted">
              {" "}
              built end-to-end on the stack you already use.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-ink-muted">
            Hi, I'm Julio. I built this so the conversation in our interview can
            be about <em>the work</em>, not pseudocode on a whiteboard. It's a
            real LangGraph agent on Vertex AI / Gemini, hybrid RAG over public
            FMCSA / NTSB / SEC data, an XGBoost loss-frequency model with SHAP,
            and an evaluation harness with three independent tracks
            (retrieval, LLM-as-judge, and ground-truth task-level).
          </p>
          <p className="mt-3 max-w-2xl text-ink-muted">
            The walkthrough is the part most candidates skip — every section
            shows the actual code that ran, the numbers it produced, and an
            honest take on where the system underperforms. The chat tab on the
            right calls the same Cloud Run service that produced those numbers.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/pipeline" className="btn-primary">
              <FileCode2 size={16} /> Walk through the pipeline
              <ArrowRight size={16} />
            </Link>
            <Link href="/chat" className="btn-secondary">
              <MessagesSquare size={16} /> Try the live agent
            </Link>
          </div>
        </div>

        <div className="card flex flex-col gap-4 p-5">
          <div>
            <div className="font-mono text-2xs uppercase tracking-[0.2em] text-ink-dim">
              At a glance
            </div>
            <div className="mt-1 text-sm text-ink">
              Commercial Auto Underwriting Copilot for mid-market trucking
              fleets.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="LLM" value="Gemini 2.5 Pro" />
            <Stat label="Judge" value="GPT-4o (cross-family)" />
            <Stat label="RAG" value="Chroma + BM25 + RRF" />
            <Stat label="Rerank" value="ms-marco MiniLM" />
            <Stat label="ML" value="XGBoost + SHAP" />
            <Stat label="Orchestration" value="LangGraph · 9 nodes" />
            <Stat label="Eval" value="3 tracks · 4 ablations" />
            <Stat label="Deploy" value="Cloud Run · Vercel" />
          </div>
          <div className="mt-1 border-t border-border pt-3 text-2xs text-ink-dim">
            Real public data: ~200 FMCSA carriers · ~500 NTSB narratives ·
            10-K risk-factor sections. Submissions are synthesized on top of
            real DOT numbers so tools always return real responses.
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
        {label}
      </div>
      <div className="text-ink">{value}</div>
    </div>
  );
}
