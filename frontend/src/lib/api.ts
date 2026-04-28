// Lightweight fetcher with absolute-path safety under basePath.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/hartford";

export function dataPath(name: string) {
  // Files under frontend/public/data/* are served at <basePath>/data/*
  return `${basePath}/data/${name}`;
}

export function snippetPath(name: string) {
  return `${basePath}/snippets/${name}`;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`fetchJson ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export type Submission = {
  id: string;
  carrier_name: string;
  dot_number: string;
  fleet_size: number;
  vehicle_mix: Record<string, number>;
  states_of_operation: string[];
  effective_date: string;
  loss_run_summary: { year: number; claims: number; incurred_usd: number }[];
  broker_email_excerpt: string;
};

export type EvalResults = {
  retrieval: {
    recall_at_5: number;
    recall_at_10: number;
    mrr: number;
    ndcg_at_10: number;
    ragas: { context_precision: number; context_recall: number; faithfulness: number };
    by_corpus: { corpus: string; recall_at_10: number; n: number }[];
  };
  generation: {
    rubric: { dimension: string; agent: number; baseline: number }[];
    pairwise_winrate_vs_baseline: number;
    judge_iqr: number;
  };
  task_level: {
    redflag_recall: number;
    hallucination_rate: number;
    materiality_precision: number;
    per_submission: { id: string; redflags_caught: number; redflags_missed: number; hallucinations: number }[];
  };
  ablations: {
    name: string;
    retrieval_recall_at_10: number;
    redflag_recall: number;
    pairwise_winrate: number;
  }[];
};
