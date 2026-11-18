// Lightweight helpers + TS mirrors of the backend export/result schemas.
// Keep browser requests in lockstep with next.config.ts. An unset base path
// means the app is served at `/`; production can opt into `/hartford`.
const configuredBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
const basePath =
  configuredBasePath && configuredBasePath !== "/"
    ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
    : "";

export function appPath(path: string) {
  const absolutePath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${absolutePath}`;
}

export function dataPath(name: string) {
  // Files under frontend/public/data/* are served at <basePath>/data/*
  return appPath(`/data/${name}`);
}

// ---------------------------------------------------------------------------
// Eval results (scripts/07_run_evals.py). Every track carries an explicit
// status; a skipped track has a reason and NO metrics.
// ---------------------------------------------------------------------------

export type TrackStatus = "ok" | "skipped" | "partial";
export type RetrievalTrack = {
  status: TrackStatus; reason?: string; method?: string;
  recall_at_5?: number | null; recall_at_10?: number | null; mrr?: number | null; ndcg_at_10?: number | null;
  n_questions?: number; n_answerable?: number; n_no_evidence?: number; abstention_accuracy?: number | null;
  by_corpus?: { corpus: string; recall_at_10: number | null; n: number }[];
  by_split?: Record<string, {n: number; recall_at_10: number | null}>;
  per_question?: {id: string; query: string; split: string; corpus: string; recall_at_10?: number; abstention_correct?: boolean; retrieved_ids: string[]; reference_ids: string[]}[];
};
export type GenerationTrack = {
  status: TrackStatus; reason?: string; n_cases?: number;
  rubric?: {dimension: string; agent: number | null; baseline: number | null}[];
  baseline_description?: string; note?: string;
};
export type TaskLevelTrack = {
  status: TrackStatus; n_cases?: number; n_expected?: number; method?: string;
  assertion_recall?: number | null; assertions_met?: number; assertions_total?: number;
  unsupported_claim_rate?: number | null; unsupported_claims?: number; claims_checked?: number;
  citation_validity?: number | null; references_used?: number; format_validity?: number | null; completion_rate?: number | null;
  latency_p50_s?: number | null;
  failures?: {id: string; error_type: string}[];
  by_split?: Record<string, TaskLevelTrack>;
  per_submission?: {id: string; split: string; run_id: string; trace_url?: string; assertion_recall: number; assertions_met: number; assertions_total: number; unsupported_claim_rate: number; unsupported_claims: number; claims_checked: number; review_status: string}[];
};
export type EvalResults = {
  schema_version?: number; generated_at?: string; evaluation_key?: string;
  benchmark?: {version: string; review_status: string; limitations: string[]; n_task_cases: number; n_retrieval_questions: number; splits: Record<string, number>; corpus_counts: Record<string, number>; task_sha256: string; retrieval_sha256: string; corpus_sha256: string};
  configuration?: {generator: string; reviewer: string; grader: string; code_sha256: string; scope: string; baseline: string};
  retrieval: RetrievalTrack; generation: GenerationTrack; task_level: TaskLevelTrack; baseline?: TaskLevelTrack;
  ablations: {status: TrackStatus; reason?: string};
  langsmith?: {dataset_url: string; dataset_id: string; retrieval_dataset_url?: string; experiments: Record<string, {id: string; name: string}>} | null;
};

// ---------------------------------------------------------------------------
// Model insights (scripts/08 → model_insights.json)
// ---------------------------------------------------------------------------

export type ModelInsights = {
  version: string;
  training_data: "parquet" | "synthetic";
  n_train: number;
  cv_metrics: { fold: number; brier: number; auc: number }[];
  model_versions: {
    name: string;
    confusion: { tp: number; fp: number; fn: number; tn: number };
    auc: number;
    precision: number;
    recall: number;
    f1: number;
    brier: number;
  }[];
  calibration: {
    raw: { p: number; e: number; n: number }[];
    calibrated: { p: number; e: number; n: number }[];
    brier_raw: number;
    brier_calibrated: number;
  };
  global_importance: { name: string; v: number }[];
  waterfall: {
    submission_id: string;
    dot_number: string;
    pred_claims_next_yr: number;
    pi_80: number[];
    base_value: number | null;
    features: { f: string; v: number }[];
    model_version: string | null;
  } | null;
};

// ---------------------------------------------------------------------------
// Retrieval example (scripts/08 → retrieval_example.json)
// ---------------------------------------------------------------------------

export type RetrievalStageHit = { id: string; score: number; source: string; snippet: string };
export type RetrievalExample = {
  schema_version?: number;
  provenance?: {
    kind: "pipeline" | "deterministic_seed_from_real_export";
    label: string;
  };
  queries: {
    query: string;
    bm25: RetrievalStageHit[];
    dense: RetrievalStageHit[];
    rrf: RetrievalStageHit[];
    reranked: RetrievalStageHit[];
  }[];
};

export type LossLandscape = {
  points: { year: number; f: number; s: number; id: string }[];
  source: string;
};

export type FarsStateMetrics = {
  year: number;
  states: { id: string; name: string; abbr: string; fatal_crashes: number }[];
  source: string;
};

export type ChunkingExample = {
  doc_id: string;
  text: string;
  chunks: { start: number; end: number; tokens: number }[];
};

// ---------------------------------------------------------------------------
// Showcase run (scripts/09_capture_showcase.py): one REAL end-to-end run.
// ---------------------------------------------------------------------------

export type ShowcaseRun = {
  generated_at: string;
  run_id: string;
  question: string;
  submission: { id: string; carrier_name: string; dot_number: string; safer_legal_name?: string | null };
  tool_calls: { id: string; name: string; input: Record<string, unknown>; output: unknown; ms: number | null }[];
  citations: { ref: string; doc_id: string; snippet: string }[];
  retrieved_count: number;
  node_timings: { node: string; t_ms: number }[];
  drafts: string[];
  critiques: { judge: string; passed: boolean; gaps: string[]; rubric_scores: Record<string, number>; error?: string | null; iter: number }[];
  memo_md: string;
  disposition: { label: string; confidence: number; drivers: string[] } | null;
  total_ms: number;
};
