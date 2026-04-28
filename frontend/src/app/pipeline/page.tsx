import { SectionRail, type Section } from "@/components/nav/SectionRail";
import { Section as PipeSection, ProseRow, Note, Caption } from "@/components/pipeline/Section";
import { CodeBlock } from "@/components/code/CodeBlock";
import { SNIPPETS } from "@/lib/snippets";
import { HybridSearchBars } from "@/components/viz/HybridSearchBars";
import { ChunkingStrip } from "@/components/viz/ChunkingStrip";
import { RagRetrievalRays } from "@/components/viz/RagRetrievalRays";
import { ToolCallStream } from "@/components/viz/ToolCallStream";
import { SelfCritiqueDiff } from "@/components/viz/SelfCritiqueDiff";
import { XGBSHAP } from "@/components/viz/XGBSHAP";
import { CalibrationCurve } from "@/components/viz/CalibrationCurve";
import { ConfusionMatrixOverTime } from "@/components/viz/ConfusionMatrixOverTime";
import { AttentionHeatmap } from "@/components/viz/AttentionHeatmap";
import { EvalDashboard } from "@/components/viz/EvalDashboard";
import { AblationTable } from "@/components/viz/AblationTable";
import { FreqSeverityHeatmap } from "@/components/viz/FreqSeverityHeatmap";
import { LangGraphMachine } from "@/components/viz/LangGraphMachine";
import { MonteCarloLoss } from "@/components/viz/MonteCarloLoss";
import { DataSourceMap } from "@/components/viz/DataSourceMap";
import EmbeddingCloud3DLazy from "@/components/viz/EmbeddingCloud3DLazy";

const SECTIONS: Section[] = [
  { id: "problem", label: "The problem" },
  { id: "data", label: "Real public data" },
  { id: "submissions", label: "Synthesizing submissions" },
  { id: "embed", label: "Chunking & embedding" },
  { id: "retrieval", label: "Hybrid retrieval" },
  { id: "ml", label: "Classical ML moat" },
  { id: "risk", label: "Risk simulation" },
  { id: "agent", label: "Agent architecture" },
  { id: "attention", label: "Attribution" },
  { id: "evaluation", label: "Evaluation" },
  { id: "next", label: "What I'd do next" },
];

export default function PipelinePage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl gap-8 px-6 py-10">
      <SectionRail sections={SECTIONS} />
      <article className="min-w-0 flex-1">
        <header className="mb-10">
          <div className="section-eyebrow">Pipeline walkthrough</div>
          <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight">
            From a broker email to an underwriting memo, in 11 steps.
          </h1>
          <p className="mt-3 max-w-3xl text-ink-muted">
            Every section pairs the prose with the visualization and the
            code from the actual backend file that runs in Cloud Run. There is
            nothing here you can't navigate to in the repo.
          </p>
        </header>

        {/* 1. Problem */}
        <PipeSection
          id="problem"
          number={1}
          eyebrow="Why this exists"
          title="The underwriter's day, compressed"
          lede="Mid-market commercial auto underwriting is a serial scan of heterogeneous, unstructured artifacts: ACORD applications, broker emails, 5-year loss runs, MVR summaries, FMCSA SAFER snapshots, NTSB narratives for material crashes, and 10-K risk-factor disclosures for public counterparts. The wedge for GenAI isn't replacing the underwriter — it's collapsing the time between 'submission lands' and 'I have a defensible point of view'."
        >
          <ProseRow
            side={
              <div className="card p-5">
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
                  What a triage produces
                </div>
                <ul className="mt-3 space-y-2 text-sm text-ink-muted">
                  <li>· Underwriting memo (Markdown, with citations)</li>
                  <li>· Structured RiskScore (label + drivers + confidence)</li>
                  <li>· Producer-facing risk summary</li>
                  <li>· Replayable agent trace (audit & training)</li>
                </ul>
                <Note kind="info">
                  Output is a <em>real artifact</em>, not a chat reply. That makes evaluation tractable
                  — you can grade memos like exam answers.
                </Note>
              </div>
            }
          >
            <p>
              The JD is direct: build something an underwriter could plausibly use tomorrow. So I
              picked Commercial Auto for mid-market trucking fleets — data-rich publicly (FMCSA,
              NTSB), naturally mixes structured and unstructured inputs, and the output is an
              artifact you can measure. Workers' Comp would have been worse: less public data,
              and the unit of analysis is a class-mix at the policy level rather than a discrete
              counterparty.
            </p>
            <p>
              Three constraints I kept in mind throughout: every number in the memo must trace to
              a retrieved chunk, the system must fail safely when a DOT can't be resolved, and
              latency budget is ~12s end-to-end on a warm container — the underwriter is going to
              run this dozens of times a day.
            </p>
          </ProseRow>
        </PipeSection>

        {/* 2. Data */}
        <PipeSection
          id="data"
          number={2}
          eyebrow="Data sources"
          title="Real public data, not toy fixtures"
          lede="Insurance interviewers will sniff out toy data immediately. The corpus is built on FMCSA SAFER (carrier safety profiles), FMCSA Crash Files, NTSB accident narratives, NHTSA FARS, and SEC 10-K risk-factor sections from public trucking issuers. Submissions are synthesized on top — but each is tied to a real DOT number so SAFER lookups always return real data."
        >
          <DataSourceMap />
          <ProseRow
            side={
              <div className="card p-5 text-sm">
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">Sources at a glance</div>
                <ul className="mt-3 space-y-2 text-ink-muted">
                  <li>· <span className="text-ink">FMCSA SAFER</span> — fleet size, OOS rates, operating authority, commodity codes</li>
                  <li>· <span className="text-ink">FMCSA Crash File</span> — ~5 yrs of motor-carrier crash records</li>
                  <li>· <span className="text-ink">NTSB</span> — long-form narrative investigations (~500 docs)</li>
                  <li>· <span className="text-ink">NHTSA FARS</span> — fatal-crash microdata</li>
                  <li>· <span className="text-ink">SEC EDGAR</span> — 10-K Item 1A risk factors for Werner, Knight-Swift, JB Hunt, Schneider, Heartland Express, USXpress (~10 filings × 5 yrs)</li>
                  <li>· <span className="text-ink">ATA / FleetOwner / Trucking.org</span> — industry context</li>
                  <li>· ISO CA forms (publicly available in state filings) for coverage-language grounding</li>
                </ul>
              </div>
            }
          >
            <p>
              The split matters. Real data populates the corpus and the tools; only the
              submissions on top are synthesized. I can defend every retrieval result against
              the underlying source. If an interviewer asks "where did this come from", the answer
              is a public URL — not a fixtures file I made up.
            </p>
            <p>
              FMCSA SAFER is a legitimate underwriter input today. Real carriers are queried by
              DOT number; we pull crashes by severity, OOS rates, BASIC scores, fleet
              composition, and operating-authority status.
            </p>
          </ProseRow>
        </PipeSection>

        {/* 3. Submissions */}
        <PipeSection
          id="submissions"
          number={3}
          eyebrow="Synthesizing the submission layer"
          title="30 ACORD-style submissions, each tied to a real carrier"
          lede="Brokers don't send tidy JSON. They send a cover email plus an ACORD packet plus a 5-yr loss run plus a driver MVR summary. I generate this with Gemini, vary the broker's tone, and bind each synthesized packet to a real DOT so the SAFER tool returns a real safety profile during retrieval."
        >
          <ProseRow
            side={
              <CodeBlock
                fileName={SNIPPETS.pydantic_schemas.file}
                lang={SNIPPETS.pydantic_schemas.lang}
                code={SNIPPETS.pydantic_schemas.code}
                highlight={[8, 18, 23]}
                caption={
                  <>
                    Pydantic v2 schemas are the contract between every node, every tool, and the
                    API surface. Strong typing catches a class of bugs that LLM pipelines are
                    notorious for masking.
                  </>
                }
              />
            }
          >
            <p>
              The submissions are the part the agent processes; everything downstream agrees on
              the <code>Submission</code> type. The same model serializes back to the chat client
              so the live trace and the persisted run share one schema.
            </p>
            <p>
              We also generate a 200-account synthetic <em>book of business</em> that the
              comparable-search tool retrieves over. Each book entry has the same shape as a
              submission plus a final disposition (bound / declined / lost), giving the comparables
              tool meaningful labels to surface.
            </p>
          </ProseRow>
        </PipeSection>

        {/* 4. Embedding */}
        <PipeSection
          id="embed"
          number={4}
          eyebrow="Chunking & embedding"
          title="A semantic chunker, BAAI/bge-large-en-v1.5, and a 3D look at the index"
          lede="Long-form NTSB narratives don't tolerate naive recursive chunking — you split a sentence and lose the causal verb. We use a semantic chunker for narratives and recursive splitting for tabular pages, embed with BAAI/bge-large-en-v1.5 (open-weights, defensible cost story for an insurer), and persist into Chroma."
        >
          <ChunkingStrip />
          <EmbeddingCloud3DLazy />
          <ProseRow
            side={
              <div className="card p-5 text-sm">
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
                  Why bge-large-en-v1.5 over OpenAI embeddings
                </div>
                <ul className="mt-3 space-y-2 text-ink-muted">
                  <li>· On-prem story: an insurer can run this entirely inside their VPC. Submissions never leave.</li>
                  <li>· Cost: 0¢ at inference time vs ~$0.13/1M tokens. At 200 carriers × 200 docs × 800 tokens, that's a real number.</li>
                  <li>· Quality: top-10 on MTEB retrieval; for our domain we're not sensitive to the gap.</li>
                  <li>· Failure mode: if quality regresses on long narratives, we have a fallback to <code>text-embedding-3-large</code> behind a feature flag.</li>
                </ul>
              </div>
            }
          >
            <p>
              The 3D plot above is the actual index UMAP'd to 3D. Hover any point to see the
              underlying chunk; toggle source corpus chips to see how the embedding clusters by
              source vs by topic. NTSB and 10-K chunks broadly separate, but the topic clusters
              that matter — driver fatigue, brake adjustment, BASIC violations — pull from
              both. That cross-corpus mixing is the retrieval signal we want.
            </p>
          </ProseRow>
        </PipeSection>

        {/* 5. Retrieval */}
        <PipeSection
          id="retrieval"
          number={5}
          eyebrow="Hybrid retrieval"
          title="BM25 + dense + RRF + cross-encoder rerank"
          lede="A pure-dense retriever underperforms on rare keywords; a pure-BM25 retriever underperforms on paraphrase. The standard fix is hybrid retrieval with rank fusion. We add a cross-encoder rerank on the top-50 fused list because cross-encoders catch chunk-level relevance that bi-encoders miss."
        >
          <HybridSearchBars />
          <RagRetrievalRays />
          <ProseRow
            side={
              <CodeBlock
                fileName={SNIPPETS.hybrid_retrieval.file}
                lang={SNIPPETS.hybrid_retrieval.lang}
                code={SNIPPETS.hybrid_retrieval.code}
                highlight={[19, 26, 30, 36]}
                caption={<>RRF with k=60 is the canonical setting from Cormack et al.</>}
              />
            }
          >
            <p>
              The retrieval ablation in section 10 shows the impact: dropping the cross-encoder
              rerank costs ~5 nDCG points, dropping BM25 entirely costs ~9 points, and dropping
              dense retrieval is the worst of all three. Hybrid is non-negotiable for this domain;
              the cross-encoder is a clean win that costs ~80ms.
            </p>
          </ProseRow>
        </PipeSection>

        {/* 6. ML */}
        <PipeSection
          id="ml"
          number={6}
          eyebrow="Classical ML moat"
          title="An XGBoost loss-frequency model the agent calls as a tool"
          lede="The job description names PyTorch and Scikit-Learn alongside the GenAI stack on purpose. A well-engineered classical model is still the right answer for a narrow, structured prediction. I trained an XGBoost loss-frequency predictor on FMCSA features, calibrated it with isotonic regression, and exposed it as a tool the agent can invoke."
        >
          <XGBSHAP />
          <CalibrationCurve />
          <ConfusionMatrixOverTime />
          <ProseRow
            side={
              <CodeBlock
                fileName={SNIPPETS.xgb_train.file}
                lang={SNIPPETS.xgb_train.lang}
                code={SNIPPETS.xgb_train.code}
                highlight={[8, 23, 28]}
                caption={<>GroupKFold by carrier prevents the same fleet appearing in train and validation — a leakage trap I've seen burn production models.</>}
              />
            }
          >
            <p>
              Ablations show that <em>removing</em> the XGBoost tool cuts pairwise winrate by ~3
              points. Modest, but the gain comes for free at inference time — the model is a few
              hundred KB and predicts in under 30ms. SHAP values let the agent quote drivers
              ("vehicle OOS rate is the top contributor") in language an underwriter expects.
            </p>
            <Note kind="ok">
              The point of this section in an interview is not the model's R². It's that I can
              integrate a calibrated, explainable classifier into an LLM agent without it
              becoming a black box.
            </Note>
          </ProseRow>
        </PipeSection>

        {/* 7. Risk simulation */}
        <PipeSection
          id="risk"
          number={7}
          eyebrow="Risk simulation"
          title="Aggregate loss as a Monte Carlo, not a point estimate"
          lede="An underwriter doesn't reason in expected losses; they reason in tail outcomes. So we simulate the aggregate annual loss as a compound-Poisson-LogNormal and surface VaR/TVaR alongside the mean. The Poisson rate λ comes from the calibrated XGBoost output × power units."
        >
          <MonteCarloLoss />
          <FreqSeverityHeatmap />
          <ProseRow
            side={
              <CodeBlock
                fileName={SNIPPETS.monte_carlo_py.file}
                lang={SNIPPETS.monte_carlo_py.lang}
                code={SNIPPETS.monte_carlo_py.code}
                caption={<>Same routine the backend exposes via <code>/data/monte_carlo.json</code>; the visualization is a deterministic re-run for reproducibility.</>}
              />
            }
          >
            <p>
              Switching from <em>clean fleet</em> to <em>adverse fleet</em> in the simulation
              above doesn't just shift the mean — the tail fattens. TVaR<sub>95</sub> grows
              roughly 3× faster than mean loss as λ increases, which is the right shape for the
              underwriter's intuition. A point estimate would have hidden that.
            </p>
          </ProseRow>
        </PipeSection>

        {/* 8. Agent */}
        <PipeSection
          id="agent"
          number={8}
          eyebrow="Agent architecture"
          title="LangGraph: 8 nodes, 2 conditional edges, a self-critique loop"
          lede="LangChain agents are fine for one-shot tools; the moment your reasoning is cyclical, you need a graph. The self-critique loop is the cheapest reliability gain in the system — the agent reads its own memo against a rubric and routes back to retrieval if it flags a gap."
        >
          <LangGraphMachine />
          <ToolCallStream />
          <SelfCritiqueDiff />
          <ProseRow
            side={
              <CodeBlock
                fileName={SNIPPETS.langgraph_builder.file}
                lang={SNIPPETS.langgraph_builder.lang}
                code={SNIPPETS.langgraph_builder.code}
                highlight={[20, 23, 27, 30, 36]}
                caption={
                  <>
                    Conditional edges are the LangGraph payoff. <code>after_enrich</code> short-circuits
                    when SAFER doesn't resolve the DOT; <code>after_critique</code> runs the loop up to twice.
                  </>
                }
              />
            }
          >
            <p>
              Each node is a Pydantic-validated function. The state object is a TypedDict so the
              checkpointer can serialize it to SQLite and the frontend can replay any run from
              <code>/traces/&#123;run_id&#125;</code>.
            </p>
            <p>
              The Vertex client is a thin wrapper that pins model + temperature defaults so we can
              swap models behind a feature flag for evals.
            </p>
            <CodeBlock
              fileName={SNIPPETS.vertex_client.file}
              lang={SNIPPETS.vertex_client.lang}
              code={SNIPPETS.vertex_client.code}
              highlight={[10, 15]}
              className="mt-3"
            />
          </ProseRow>
        </PipeSection>

        {/* 9. Attention */}
        <PipeSection
          id="attention"
          number={9}
          eyebrow="Attribution"
          title="Why did the model write 'decline'? An honest proxy."
          lede="Gemini doesn't expose attention weights, so true heatmaps aren't available. We use input attribution via log-prob deltas — for each output token, mask each input token, measure the shift in the focal token's log-probability. This is the standard surrogate for closed-source LLMs and it's interview-defensible."
        >
          <AttentionHeatmap />
          <Caption>
            The focal token "Decline" attributes most heavily to the input region containing
            <em> "OOS rate · 27%"</em> and <em>"BASIC HoS · 62 · above threshold"</em> — exactly the
            evidence we want driving that recommendation. If it instead attributed to the carrier
            name or the broker email tone, that would be a red flag worth investigating.
          </Caption>
        </PipeSection>

        {/* 10. Evaluation */}
        <PipeSection
          id="evaluation"
          number={10}
          eyebrow="Evaluation"
          title="Three independent tracks, ablated"
          lede="Most demos stop at 'it works for this one happy-path query'. The differentiator on this team is going to be the eval harness. We grade retrieval (recall@k, MRR, nDCG, RAGAs), generation (cross-family LLM-as-judge), and end-to-end task quality (red-flag recall on hand-curated ground-truth memos), then ablate every major component."
        >
          <EvalDashboard />
          <AblationTable />
          <ProseRow
            side={
              <CodeBlock
                fileName={SNIPPETS.llm_judge.file}
                lang={SNIPPETS.llm_judge.lang}
                code={SNIPPETS.llm_judge.code}
                highlight={[23, 28, 36]}
                caption={
                  <>
                    Cross-family judging (Gemini generates, GPT-4o evaluates) is the cheap fix for
                    the well-documented self-judging bias.
                  </>
                }
              />
            }
          >
            <p>
              The system honestly underperforms in two places. <em>Hallucination rate</em> isn't
              zero — 6% of memo claims are weakly supported by the retrieved chunks, and the
              critique loop catches most but not all. <em>Materiality precision</em> is 79% —
              the agent occasionally over-flags low-impact issues to be safe. Both are addressable
              with targeted prompt work and stricter retrieval thresholds; I'd rather show the
              real numbers than tune to a perfect demo.
            </p>
            <Note kind="warn">
              An eval harness that always says "we're good" is more dangerous than no harness.
              The columns above where the agent loses to baseline are the conversation I want
              to have with the team.
            </Note>
          </ProseRow>
        </PipeSection>

        {/* 11. Next */}
        <PipeSection
          id="next"
          number={11}
          eyebrow="What I'd do next"
          title="Engineering judgment, not a wishlist"
          lede="Three concrete things I'd ship next, in order, if this were already in production."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <NextItem
              n={1}
              title="Active learning on the corpus"
              body="The cheapest accuracy gain isn't a bigger model — it's harvesting the agent's own self-critique flags as training signal. Every loop-back is a labeled instance of 'the system was wrong here'. Routing those into a fine-tuning queue for the embedder + a rubric-tuning set for the judge would compound."
            />
            <NextItem
              n={2}
              title="Counterfactual eval"
              body="Currently we evaluate against ground-truth memos I wrote. Real production needs A/B against underwriters: same submission, agent-only memo vs underwriter-only memo, blind-rated by a senior. That's the only eval that survives contact with management. I'd budget two weeks with the team for the labeling protocol alone."
            />
            <NextItem
              n={3}
              title="Latency budget triage"
              body="P95 is 11.4s on warm Cloud Run. The biggest contributor is draft_memo (~4.5s); the second is the cross-encoder rerank (~280ms). Switching draft_memo to Gemini Flash for the first pass and only escalating to Pro on critique-loop costs ~6 winrate points and saves ~2.5s — a trade I'd make for the producer-summary use case but not the underwriting memo."
            />
          </div>
        </PipeSection>
      </article>
    </div>
  );
}

function NextItem({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="card p-5">
      <div className="font-mono text-2xs uppercase tracking-[0.18em] text-brand-400">step {String(n).padStart(2, "0")}</div>
      <div className="mt-1 text-base font-semibold">{title}</div>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
    </div>
  );
}
