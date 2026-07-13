import { SectionRail, type Section } from "@/components/nav/SectionRail";
import { Section as PipeSection, ProseRow, Note, Caption, PlainEnglish, Glossary } from "@/components/pipeline/Section";
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

        <PlainEnglish title="Start here · what this is, in 60 seconds">
          <p>
            <strong>The job:</strong> when a trucking company applies for commercial-auto
            insurance at The Hartford, an underwriter has to read a stack of documents and
            decide whether to insure them, decline, or charge more. It takes hours per
            account.
          </p>
          <p>
            <strong>What we built:</strong> an AI assistant that reads the same documents,
            looks up the carrier&apos;s safety record, runs a small statistical model on
            their loss history, and writes a draft underwriting memo with citations.
            It doesn&apos;t replace the underwriter — it gives them a defensible first
            pass in seconds instead of hours.
          </p>
          <p>
            <strong>Why this walkthrough exists:</strong> most AI demos stop at &ldquo;look,
            it answered a question.&rdquo; That&apos;s not enough for an insurer. The 11
            sections below show every component end-to-end: where the data comes from,
            how the AI reads it, how we measure whether the answer is any good, and
            where the system honestly underperforms.
          </p>
          <p className="text-ink-muted">
            You can read this without an AI background or an insurance background. Each
            section opens with a plain-English summary like this one, then dives into
            the technical detail underneath.
          </p>
          <Glossary
            items={[
              { term: "Underwriter", def: "the person at the insurer who decides whether to take on a customer's risk and at what price." },
              { term: "Carrier", def: "the trucking company applying for insurance — the customer." },
              { term: "Submission / packet", def: "the application bundle: a form, broker email, loss history, driver records." },
              { term: "Memo", def: "the underwriter's written rationale — what the system produces here." },
              { term: "GenAI", def: "generative AI — the LLM that drafts the memo and reasons over the documents." },
              { term: "Agent", def: "an LLM that can also call tools and loop, not just answer in one shot." },
              { term: "RAG", def: "retrieval-augmented generation — fetching relevant documents before the LLM writes." },
              { term: "Vertex AI", def: "Google Cloud's hosted-LLM service. We use it for the Gemini model family." },
              { term: "LLM-as-a-judge", def: "using a second AI to grade the first AI's answers against a rubric — like a teacher marking essays. We use a judge from a DIFFERENT vendor so it can't be biased toward its own style." },
              { term: "Ablation", def: "turning one component off and re-measuring, to prove what each part contributes. If scores don't drop, the component wasn't earning its keep." },
            ]}
          />
        </PlainEnglish>

        {/* 1. Problem */}
        <PipeSection
          id="problem"
          number={1}
          eyebrow="Why this exists"
          title="The underwriter's day, compressed"
          lede="Mid-market commercial auto underwriting is a serial scan of heterogeneous, unstructured artifacts: ACORD applications, broker emails, 5-year loss runs, MVR summaries, FMCSA SAFER snapshots, NTSB narratives for material crashes, and 10-K risk-factor disclosures for public counterparts. The wedge for GenAI isn't replacing the underwriter — it's collapsing the time between 'submission lands' and 'I have a defensible point of view'."
        >
          <PlainEnglish>
            <p>
              When you apply for car insurance, the company looks at your driving record and
              charges accordingly. <strong>Commercial auto</strong> is the same idea but for
              trucking companies — and the &ldquo;driving record&rdquo; is way bigger: hundreds
              of trucks, dozens of states, federal safety inspections, prior crashes, who they
              haul for, and so on. An <em>underwriter</em> reads all of that to decide what to
              charge — or whether to insure them at all.
            </p>
            <p>
              The job is mostly about <em>finding the signal</em>: out of dozens of pages,
              what are the few facts that should change the price? AI is good at this kind of
              search-and-summarize work, which is why it&apos;s a great fit here.
            </p>
          </PlainEnglish>
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
          lede="Insurance interviewers will sniff out toy data immediately. The corpus is built on FMCSA SAFER (carrier safety profiles), NTSB accident-investigation narratives, NHTSA FARS fatal-crash counts, and SEC 10-K risk-factor sections from public trucking issuers. Submissions are synthesized on top — but each is tied to a real DOT number verified to resolve in SAFER, so carrier lookups always return real data."
        >
          <PlainEnglish>
            <p>
              Real underwriters don&apos;t guess; they look up. Every commercial trucking
              company has a unique federal ID called a <strong>DOT number</strong>. Type that
              number into the U.S. government&apos;s <em>SAFER</em> database and you get a
              fact sheet: how many trucks, how many crashes, how often inspectors took a truck
              off the road for being unsafe, and so on. We use the same public sources here.
            </p>
            <p>
              Below: every state is shaded by its count of fatal crashes in the federal
              FARS database — hover any state to see the real number. It&apos;s one of the
              public datasets this system draws on, and a reminder of why the underwriting
              question matters: these are real losses, not abstractions.
            </p>
          </PlainEnglish>
          <DataSourceMap />
          <ProseRow
            side={
              <div className="card p-5 text-sm">
                <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">Sources at a glance</div>
                <ul className="mt-3 space-y-2 text-ink-muted">
                  <li>· <span className="text-ink">FMCSA SAFER</span> — fleet size, crash counts, out-of-service rates, operating authority; queried live by DOT number and cached</li>
                  <li>· <span className="text-ink">NTSB</span> — long-form narrative crash investigations (curated highway-mode set)</li>
                  <li>· <span className="text-ink">NHTSA FARS</span> — fatal-crash counts by state (the map above)</li>
                  <li>· <span className="text-ink">SEC EDGAR</span> — 10-K Item 1A risk factors for 7 public truckers (Werner, Knight-Swift, JB Hunt, Schneider, Heartland, US Xpress, Old Dominion), up to 5 filings each</li>
                  <li>· <span className="text-ink">Industry docs + ISO CA coverage forms</span> — pricing and coverage-language grounding</li>
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
          lede="Brokers don't send tidy JSON. They send a cover email plus an ACORD packet plus a 5-yr loss run plus a driver MVR summary. I script the synthesis with realistic broker tones and bind each synthesized packet to a real DOT so the SAFER tool returns a real safety profile during retrieval. The live agent itself uses Gemini 2.5 Pro for memo drafting and Gemini 2.5 Flash for parsing and self-critique."
        >
          <PlainEnglish>
            <p>
              Real customer applications are sensitive — we can&apos;t put 30 of them on a
              public website. So we make up <em>fake applications</em>, but each one points
              at a <em>real</em> trucking company&apos;s DOT number. When the AI looks the
              company up in the federal database, it gets real data. When the AI quotes
              numbers, those numbers are real. Only the cover email and the policy paperwork
              are synthesized.
            </p>
            <p>
              The code on the right is the contract — the &ldquo;shape&rdquo; that every
              piece of the system agrees on. If a broker email is missing the fleet size,
              the system can&apos;t pretend it has one; the type system stops it. This is
              how you keep an AI from hallucinating numbers nobody told it.
            </p>
          </PlainEnglish>
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
          <PlainEnglish>
            <p>
              An LLM can&apos;t read every document on every question — it&apos;s too slow
              and too expensive. So we do two things first:
            </p>
            <p>
              <strong>1. Chunking.</strong> Break each long document into bite-size pieces
              (~200 words each). Smart chunking respects sentence and paragraph boundaries
              so context isn&apos;t lost mid-thought.
            </p>
            <p>
              <strong>2. Embedding.</strong> Convert each chunk into a list of numbers
              (a &ldquo;vector&rdquo;) that captures its <em>meaning</em>. Two chunks
              about driver fatigue end up close together in this number space, even if they
              use different words. The 3D plot below is exactly that: every chunk in the
              index, colored by which corpus it came from. Spin it. Where colors mix, the
              <em> topics</em> are what matter — that&apos;s a healthy embedding.
            </p>
          </PlainEnglish>
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
          <PlainEnglish>
            <p>
              When the AI needs to answer a question about a specific risk, we have to
              find the right ~10 chunks out of thousands. There are two classic ways:
            </p>
            <p>
              <strong>Keyword search</strong> (called <em>BM25</em>) — like Google before
              the era of meaning. Great when the exact word matters (&ldquo;hazmat&rdquo;,
              &ldquo;BASIC&rdquo;), bad when it doesn&apos;t.
            </p>
            <p>
              <strong>Meaning search</strong> (called <em>dense retrieval</em>) — uses
              those embedding vectors from the previous step. Great at paraphrase
              (&ldquo;tired driver&rdquo; ≈ &ldquo;driver fatigue&rdquo;), bad at unusual
              words it didn&apos;t see during training.
            </p>
            <p>
              We run <em>both</em> and merge the lists. The visualization below shows it
              live: BM25&apos;s ranking, the dense model&apos;s ranking, and the fused
              final list that combines both.
            </p>
          </PlainEnglish>
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
              The rankings above are the real pipeline's output for a golden-set query, stage
              by stage — where BM25 and the dense model disagree is precisely the value of
              running both. Section 10's eval dashboard carries the measured retrieval metrics
              (recall@k, MRR, nDCG) and the ablation harness re-runs the agent with retrieval
              disabled to quantify the contribution. The cross-encoder rerank costs on the
              order of 100ms on CPU and consistently cleans up the fused ordering.
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
          <PlainEnglish>
            <p>
              Big LLMs are great at reading and writing. They&apos;re <em>not</em> the
              right tool for predicting a number from a row of fleet statistics — like
              &ldquo;given these 10 facts about a trucking company, how many crashes
              should we expect next year?&rdquo;
            </p>
            <p>
              For that we use a much smaller, much older kind of model called <strong>XGBoost</strong>.
              It&apos;s ~50× cheaper to run, returns a number in milliseconds, and you
              can audit its reasoning. The bar chart below shows which features pushed
              the prediction up or down — &ldquo;OOS rate&rdquo; (how often a truck was
              taken off the road during inspection) is the biggest driver. The agent calls
              this little model as if it were one of its tools, and quotes the
              answer in the memo.
            </p>
            <p className="text-ink-muted">
              The point: a good system uses GenAI <em>and</em> classical ML where each one is
              actually best.
            </p>
          </PlainEnglish>
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
              The ablation harness re-runs the agent with the XGBoost tool disabled to measure
              its contribution (see the eval dashboard for the measured numbers). The gain comes
              nearly free at inference time — the model is a few hundred KB and predicts in under
              30ms. SHAP values let the agent quote drivers ("vehicle OOS rate is the top
              contributor") in language an underwriter expects.
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
          <PlainEnglish>
            <p>
              A trucking company might cost the insurer $0 in a year (no crashes) or
              $10M+ (one big lawsuit). The <em>average</em> doesn&apos;t tell you how
              bad it can get. Underwriters need to know the <strong>worst-case
              year</strong>, not just the typical one.
            </p>
            <p>
              The simulation below rolls the dice 10,000 times: each simulated year
              draws how many crashes happen, then how expensive each crash is, then
              adds them up. Watch the histogram fill in. Two markers slide live:
              <span className="text-warn-400"> VaR<sub>95</sub></span> (the loss exceeded
              only 1 year in 20) and <span className="text-brand-400"> TVaR<sub>95</sub></span>
              (the average of those bad years). Switch to the &ldquo;Adverse fleet&rdquo;
              dropdown — the average barely moves, but the right tail explodes. <em>That&apos;s
              the right shape for an underwriter&apos;s intuition.</em>
            </p>
          </PlainEnglish>
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
          title="LangGraph: 9 nodes, 2 conditional edges, a self-critique loop"
          lede="LangChain agents are fine for one-shot tools; the moment your reasoning is cyclical, you need a graph. The self-critique loop is the cheapest reliability gain in the system — the agent reads its own memo against a rubric and routes back to retrieval if it flags a gap."
        >
          <PlainEnglish>
            <p>
              An <strong>agent</strong> is an LLM that doesn&apos;t just answer questions
              — it follows a recipe. Read the application → look up the carrier → fetch
              relevant evidence → compute the loss numbers → write the memo → check its own
              work. If it finds a gap, it goes <em>back</em> to fetch more evidence and
              re-writes. That &ldquo;go back if you missed something&rdquo; is the loop you
              see in the diagram below.
            </p>
            <p>
              The animation walks three example scenarios — a clean account, a tricky one
              that triggers the critique loop, and an edge case where the carrier can&apos;t
              be looked up. The boxes and arrows exactly match the backend graph code (shown
              on the right); the timings are representative. To watch a REAL run, use the
              live chat page: the same diagram lights up there with real timings.
            </p>
            <p className="text-ink-muted">
              Why this design? Because the worst failure mode for an AI underwriter is
              <em> sounding confident while missing something material</em>. The critique
              loop is cheap insurance against that.
            </p>
          </PlainEnglish>
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
          <PlainEnglish>
            <p>
              When the AI writes &ldquo;Decline&rdquo;, can we check that the decision came
              from the <em>data</em> and not from, say, the broker&apos;s tone of voice?
              The heatmap below demonstrates the auditing method: pick an output word from
              the dropdown, and the strip lights up the input words that would most
              influence it. For &ldquo;Decline,&rdquo; the honest answer should be
              &ldquo;OOS rate · 27%&rdquo; and &ldquo;BASIC HoS · above threshold&rdquo;,
              not the carrier&apos;s name.
            </p>
            <p className="text-ink-muted">
              As the badge says, this panel illustrates the METHOD with mock values —
              Gemini doesn&apos;t expose its internals, so the real version computes token
              log-prob shifts under input masking. If a production recommendation lit up on
              the broker&apos;s greeting rather than the safety data, that would be a red
              flag this view is designed to catch.
            </p>
          </PlainEnglish>
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
          lede="Most demos stop at 'it works for this one happy-path query'. The differentiator on this team is going to be the eval harness. We grade retrieval (recall@k, MRR, nDCG), generation (cross-family LLM-as-judge), and end-to-end task quality (red-flag recall on hand-curated ground-truth memos), then ablate every major component by re-running the real agent with each one disabled."
        >
          <PlainEnglish>
            <p>
              How do you know an AI is any good? You grade it. Three independent ways:
            </p>
            <p>
              <strong>1. Retrieval</strong> — When we ask a question, do the right
              documents come back? Numbers like &ldquo;recall@10&rdquo; mean &ldquo;of
              the 10 we fetched, what fraction were the ones the question wanted.&rdquo;
            </p>
            <p>
              <strong>2. Memo quality</strong> — A different AI (GPT-4o, from a different
              vendor than our writer) reads each memo and scores it. We use a different
              vendor on purpose — an AI grading itself is biased. Then we compare against
              a baseline (just an LLM, no agent) — we want our system to win.
            </p>
            <p>
              <strong>3. Task-level</strong> — For a hand-curated set of applications I
              wrote down the expected answer first: which red flags MUST appear, and which
              claims must NOT. The AI&apos;s memos are checked against that: did it spot
              the same red flags? Did it claim things the data doesn&apos;t support?
            </p>
            <p>
              <strong>And ablations</strong> — turn off each major component (RAG, the
              critique loop, the small ML model) and rerun the whole eval. The drop tells
              you what each component is worth. If turning a component <em>off</em>
              didn&apos;t hurt scores, you don&apos;t need it.
            </p>
          </PlainEnglish>
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
              Every number on this dashboard comes from an actual eval run; tracks that
              haven't run yet say so instead of showing placeholders. The two metrics to
              scrutinize are the <em>hallucination count</em> (forbidden claims that slip
              past the critique loop) and the ablation deltas (a component whose removal
              doesn't move red-flag recall isn't earning its latency). I'd rather show
              real numbers with warts than tune the harness to a perfect demo — an eval
              that always says "we're good" is worse than no eval.
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
              body="draft_memo dominates the latency budget (several seconds of Gemini Pro streaming); the cross-encoder rerank is second (~hundreds of ms on CPU). The obvious experiment: Gemini Flash for the first draft, escalate to Pro only when the critique loop fires, and measure the winrate cost with the ablation harness before shipping the trade."
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
