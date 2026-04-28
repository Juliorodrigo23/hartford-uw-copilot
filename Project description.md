JD:
Data Scientist - GD08AE

We’re determined to make a difference and are proud to be an insurance company that goes well beyond coverages and policies. Working here means having every opportunity to achieve your goals – and to help others accomplish theirs, too. Join our team as we help shape the future.   

         

Step into the future with The Hartford as an AI Scientist, where Generative AI isn’t just a buzzword—it’s central to our strategy. Join a team that’s advancing AI‑driven solutions across underwriting and sales enablement, transforming how complex commercial risks are evaluated and decisions are made. As part of our Applied AI Middle & Large Business team, you’ll work on high‑impact use cases and help shape the development of GenAI capabilities embedded directly into core business workflows. Here, your work delivers real, measurable impact—driving innovation, efficiency, and smarter decision‑making with cutting‑edge AI tools. If you’re looking for a role where your expertise is essential to the future of commercial insurance, The Hartford is the place for you.

We are looking for a technically proficient GenAI data scientist with deep implementation experience in building and evaluating GenAI systems, and a proven ability to stay at the forefront tools and techniques in the evolving AI landscape.

This role can have a Hybrid or Remote work schedule. Candidates who live near one of our locations will have the expectation of working in an office 3 days a week (Tuesday through Thursday). 

Responsibilities: 

Support The Hartford’s AI innovation strategy to identify and implement high-end use cases, ensuring alignment with business objectives and emerging industry trends.  
Support cutting-edge AI vision and roadmap for the enterprise to make The Hartford a leader in using AI for the insurance industry. 
Partner with stakeholders internal to the Data Science organization, Technology organization and business organization, aligning with business objectives and driving innovation to improve productivity and efficiency of underwriting and sales efforts. 
Design and build GenAI solutions for tasks such as summarization, question answering, search, data synthesis, etc. 

Design, build, and support traditional machine learning solutions, while developing and maintaining robust Python infrastructure using strong coding fundamentals such as object‑oriented programming, modular design, and testing.
Apply AI techniques to complex and heterogeneous risk exposures within Middle & Large Commercial portfolios.
Rapidly prototype with cutting-edge tools, such as VertexAI/Google agent development kit,  LangChain/LangGraph, RAG frameworks, HuggingFace, OpenAI APIs, etc. 
Research and recommend novel foundation model options, tools, and libraries to improve solutions in performance and reliability. 
Develop evaluation pipelines for generative outputs using a mix of automatic metrics, human feedback, and llm-as-a-judge methods. 
Collaborate with ML Ops to ensure best practice is followed for scalable training and deployment.  


Qualifications: 

Master’s or PhD in Computer Science, Artificial Intelligence, Machine Learning, Engineering or a related field. 
3+ years of industry experience in machine learning or data science and with 1+ years focused on GenAI. 
Proven experience in GenAI tools such as Vertex AI/Google agent development kit, LangChain/LangGraph, RAG frameworks, HuggingFace, OpenAI APIs, etc. 
Solid understanding of prompt engineering, retrieval-augmented generation (RAG), agent workflow, and LLM evaluation. 
Proficiency in Python and ML frameworks such as Scikit-Learn, PyTorch, TensorFlow, etc. 
Experience developing and deploying agentic AI workflows and systems
Experience with vector databases such as Chroma, Pinecone, etc. and cloud platforms such as GCP, AWS, Azure, etc. 
Strong analytical, problem solving and debugging skills.  
Excellent communication and collaboration skills, with the ability to explain complex technical concepts to non-technical stakeholders across the enterprise.

Candidate must be authorized to work in the US without company sponsorship. The company will not support the STEM OPT I-983 Training Plan endorsement for this position.

Compensation

The listed annualized base pay range is primarily based on analysis of similar positions in the external market. Actual base pay could vary and may be above or below the listed range based on factors including but not limited to performance, proficiency and demonstration of competencies required for the role. The base pay is just one component of The Hartford’s total compensation package for employees. Other rewards may include short-term or annual bonuses, long-term incentives, and on-the-spot recognition. The annualized base pay range for this role is:

$90,160 - $135,240

PLAN:

Quick read before the plan
Three strategic notes upfront:

Pick a use case that mirrors their actual workflow, not a generic RAG demo. The JD calls out "Middle & Large Commercial" underwriting and sales enablement. That's complex commercial risk, not personal auto. If you build a personal auto chatbot, you've missed the target. The system should look like something an underwriter or producer at The Hartford could plausibly use tomorrow.
The differentiator is evaluation, not the agent. Every candidate will show up with a LangGraph agent. Few will show a real eval harness with LLM-as-a-judge, ground truth comparisons, and ablations. The JD spends a full bullet on evaluation pipelines, that's your wedge.
Don't fake the data. Insurance interviewers will sniff out toy data immediately. Use real public datasets (NHTSA, FMCSA, OpenFEMA, SEC filings, OSHA) so the demo feels grounded. Synthesize only the policy and submission data on top.

Now the plan.

The system: Commercial Auto Underwriting Copilot
One-line pitch: An agentic assistant that helps a commercial auto underwriter triage a new submission for a mid-market trucking or fleet account by pulling loss history, retrieving comparable risks, summarizing exposure, and flagging concerns, with a structured underwriting memo as output.
Why this specific use case:

Maps directly to "Middle & Large Commercial" in the JD
Commercial auto is data-rich publicly (FMCSA, NHTSA), unlike workers' comp or property
Naturally combines structured data (loss runs, vehicle counts, MVRs) with unstructured (broker emails, loss descriptions, safety reports), which is exactly what RAG plus tool-using agents are good for
The output is a real artifact (underwriting memo), not just a chat response, which makes evaluation tractable
"Sales enablement" angle: the same system can generate a producer-facing risk summary


Data sources (all real, all free)
Structured / tabular

FMCSA SAFER and SAFER Web — DOT carrier safety data: crash history, inspection results, out-of-service rates, fleet size, vehicle types, operating authority. This is gold for commercial auto. SAFER Company Snapshot is queryable by DOT number.
FMCSA Motor Carrier Census — fleet composition, operating regions, commodity types
NHTSA FARS (Fatality Analysis Reporting System) — crash-level data, vehicle characteristics, contributing factors
NHTSA Crash Report Sampling System (CRSS) — broader non-fatal crash sample
BTS (Bureau of Transportation Statistics) — vehicle miles traveled, freight movement by region
OSHA establishment search — workplace safety records, related industry exposure

Unstructured / for the RAG corpus

NTSB accident reports — long-form narrative crash investigations, perfect chunking targets
FMCSA enforcement and crash narratives from public filings
State DOT inspection reports where available
SEC 10-K filings of public trucking companies (Werner, Knight-Swift, JB Hunt, Schneider, etc.) for risk factors, fleet descriptions, claim disclosures, this is what real underwriters read
Industry publications (Trucking.org, FleetOwner, public ATA reports)
Standard commercial auto coverage forms (ISO CA forms are publicly available in many state filings)

Synthesized layer (you generate this)

20 to 50 fake submission packets: ACORD-style application data, broker cover emails, loss runs, driver MVR summaries
Tie each fake submission to a real DOT number so the structured tools return realistic data

This split is important. Real public data for the corpus and tools, synthesized submissions on top. You can defend every piece of it in an interview.

Architecture
                    [Underwriter Submission Input]
                              |
                              v
                    [LangGraph Orchestrator]
                              |
        +---------------------+----------------------+
        |                     |                      |
        v                     v                      v
   [Retrieval Agent]    [Tool-Use Agent]     [Synthesis Agent]
        |                     |                      |
        v                     v                      v
   Chroma (RAG over     Tools:                  Generates:
   NTSB, 10-Ks,         - FMCSA SAFER lookup    - Underwriting memo
   coverage forms,      - FARS crash query      - Risk score + rationale
   industry reports)    - Loss ratio calc       - Producer summary
                        - Comparable risk
                          retrieval (vector)
                              |
                              v
                    [Evaluation Harness]
                    - Automatic metrics
                    - LLM-as-judge rubric
                    - Ground truth comparisons
LangGraph state machine, concretely:
Nodes:

parse_submission — extract structured fields from broker email + ACORD data
enrich_carrier — call FMCSA tools to pull safety profile by DOT number
retrieve_context — RAG over NTSB narratives and 10-K risk factors for similar fleets
analyze_loss_history — compute frequency, severity, trend from loss run
find_comparables — vector search for similar accounts in your synthesized book
draft_memo — Gemini or GPT generates the underwriting memo
self_critique — LLM reviews its own memo against a rubric, can route back to retrieve more
finalize — emit memo + structured risk indicators

Edges: conditional routing based on whether the carrier has sufficient data, whether self-critique flags gaps, whether confidence thresholds are met. This is where LangGraph beats LangChain, show the cyclic reasoning explicitly.

Tech stack mapped to JD requirements
JD requirementYour implementationVertex AIUse Gemini 1.5 Pro / 2.0 via Vertex AI for the main LLM, deploy the agent endpoint on Cloud Run, use Vertex AI Evaluation for one of the eval tracksGoogle ADKBuild a parallel implementation of one agent in ADK to show range, even if LangGraph is the primaryLangChain / LangGraphPrimary orchestration, document the state graphRAGChroma for the document corpus, hybrid search (BM25 + dense), rerank with Cohere or a cross-encoderChromaLocal for dev, persistent collection per document type (NTSB, 10-Ks, coverage forms)HuggingFaceUse sentence-transformers for embeddings (e.g., BAAI/bge-large-en-v1.5), document why over OpenAI embeddings (cost, latency, on-prem story for an insurer)OpenAI APIsUse GPT-4o for the LLM-as-judge layer, intentionally different from the generator to avoid self-judging bias, this is a sophisticated detail interviewers will respectAgentic workflowsLangGraph with tools, self-critique loop, conditional routingPython OOP / modular / testingPydantic models for all submission and memo schemas, pytest suite, ruff + mypy, proper package structureScikit-Learn / PyTorchTrain a small XGBoost loss-frequency model on FMCSA crash data, expose it as a tool the agent calls. This proves you can do classical ML alongside GenAI, which is a frequent gap for GenAI-only candidatesMLOpsDockerize, GitHub Actions CI, deploy to Cloud Run, basic Langfuse or LangSmith tracing

The evaluation harness (your differentiator)
Build three eval tracks. This is what will set you apart.
Track 1: Retrieval quality

Build a labeled set of 30 to 50 questions with known relevant chunks
Metrics: recall@k, MRR, nDCG
Use RAGAs for context precision, context recall, faithfulness

Track 2: Generation quality (LLM-as-judge)

Define a rubric: factual accuracy, completeness, calibration of risk language, citation discipline, format adherence
Use GPT-4o as judge, Gemini as generator (cross-family judging)
Generate pairwise comparisons against a baseline (single-shot prompt vs your full agent)
Show the agent wins on N out of M dimensions

Track 3: Task-level evaluation

10 to 20 hand-curated submissions with "ground truth" memos you write yourself
Measure: did the agent surface the same red flags? Did it miss anything material? Did it hallucinate exposures that weren't there?
This is the most defensible eval because it mirrors how an insurer would actually validate the system

Bonus: ablation table. Show performance with and without RAG, with and without self-critique, with and without the comparables tool. Interviewers love ablations.