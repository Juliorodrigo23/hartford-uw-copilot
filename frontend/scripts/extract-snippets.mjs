/** Refresh walkthrough excerpts from actual backend source; never reads .env. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const definitions = {
  pydantic_schemas: ["backend/app/schemas.py", "class VehicleMix", "class ToolCall"],
  langgraph_builder: ["backend/app/graph/builder.py", "def _wire", "@lru_cache"],
  hybrid_retrieval: ["backend/app/rag/hybrid_search.py", "def _rrf", "def search_stages"],
  xgb_train: ["backend/app/ml/train_xgb.py", "def _fit_one", "def _oof_predictions"],
  monte_carlo_py: ["backend/app/ml/risk_simulation.py", "def aggregate_loss_distribution", null],
  vertex_client: ["backend/app/llm/vertex_client.py", "def gemini(", "@lru_cache"],
  llm_judge: ["backend/app/eval/scoring.py", "@traceable", null],
};
const snippets = {};
for (const [key, [file, start, end]] of Object.entries(definitions)) {
  const source = await fs.readFile(path.join(repo, file), "utf8");
  const a = source.indexOf(start);
  const b = end ? source.indexOf(end, a + start.length) : source.length;
  if (a < 0 || b < 0) throw new Error(`Missing source boundary in ${file}`);
  snippets[key] = { file, lang: "python", code: source.slice(a, b).trim() };
}
await fs.writeFile(path.join(repo, "frontend/src/lib/snippets.ts"), `/** Generated verbatim from backend source by scripts/extract-snippets.mjs. */\nexport const SNIPPETS = ${JSON.stringify(snippets, null, 2)} as const;\n`);
console.log(`Refreshed ${Object.keys(snippets).length} source excerpts.`);
