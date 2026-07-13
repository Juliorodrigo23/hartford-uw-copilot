// Lightweight helpers + TS mirrors of the backend export/result schemas.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/hartford";

export function dataPath(name: string) {
  // Files under frontend/public/data/* are served at <basePath>/data/*
  return `${basePath}/data/${name}`;
}

// ---------------------------------------------------------------------------
// Eval results (scripts/07_run_evals.py). Every track carries an explicit
// status; a skipped track has a reason and NO metrics.
// ---------------------------------------------------------------------------

export type TrackStatus = "ok" | "skipped";

export type RetrievalTrack = {
  status: TrackStatus;
  reason?: string;
  recall_at_5?: number;
  recall_at_10?: number;
  mrr?: number;
  ndcg_at_10?: number;
  by_corpus?: { corpus: string; recall_at_10: number; n: number }[];
  n_questions?: number;
};

export type GenerationTrack = {
  status: TrackStatus;
  reason?: string;
  rubric?: { dimension: string; agent: number; baseline: number }[];
  pairwise_winrate_vs_baseline?: number;
  judge_iqr?: number;
  n_cases?: number;
};

export type TaskLevelTrack = {
  status: TrackStatus;
  reason?: string;
  redflag_recall?: number;
  hallucination_rate?: number;
  n_cases?: number;
  per_submission?: { id: string; redflags_caught: number; redflags_missed: number; hallucinations: number }[];
};

export type AblationRow = {
  name: string;
  status: TrackStatus;
  reason?: string;
  retrieval_recall_at_10?: number | null;
  redflag_recall?: number;
  hallucination_rate?: number;
  n_cases?: number;
};

export type EvalResults = {
  generated_at?: string;
  retrieval: RetrievalTrack;
  generation: GenerationTrack;
  task_level: TaskLevelTrack;
  ablations: { status: TrackStatus; reason?: string; rows?: AblationRow[] };
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
