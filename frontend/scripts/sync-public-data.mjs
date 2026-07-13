/**
 * Copy tracked backend visualization exports into Next's public directory.
 *
 * Vercel builds from Git, while frontend/public/data is intentionally
 * ignored. This zero-dependency predev/prebuild step validates every file
 * with the browser's strict JSON parser before copying it. If the canonical
 * retrieval export is absent or contains Python's non-standard `NaN`, the
 * deterministic real-export-derived seed is installed instead.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const sourceDir = path.join(repoRoot, "backend", "data", "exports");
const targetDir = path.join(frontendRoot, "public", "data");
// Keep the deterministic retrieval fallback inside the frontend package so
// isolated Vercel builds do not depend on files above the project root.
const retrievalSeed = path.join(scriptDir, "retrieval_example.seed.json");

function parseStrictJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not browser-compatible JSON: ${error.message}`);
  }
}

function validateRetrieval(payload, source) {
  if (!payload || !Array.isArray(payload.queries) || payload.queries.length === 0) {
    throw new Error(`${source} has no retrieval queries`);
  }
  for (const [queryIndex, query] of payload.queries.entries()) {
    for (const stage of ["bm25", "dense", "rrf", "reranked"]) {
      const hits = query[stage];
      if (!Array.isArray(hits) || hits.length === 0) {
        throw new Error(`${source} queries[${queryIndex}].${stage} has no hits`);
      }
      for (const [hitIndex, hit] of hits.entries()) {
        if (!Number.isFinite(hit?.score)) {
          throw new Error(
            `${source} queries[${queryIndex}].${stage}[${hitIndex}] has a non-finite score`,
          );
        }
      }
    }
  }
  return payload;
}

async function atomicWriteJson(name, payload) {
  const output = path.join(targetDir, name);
  const temporary = path.join(targetDir, `.${name}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(payload)}\n`);
  await fs.rename(temporary, output);
}

await fs.mkdir(targetDir, { recursive: true });
let names = [];
try {
  names = (await fs.readdir(sourceDir)).filter((name) => name.endsWith(".json"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

let retrievalInstalled = false;
let copied = 0;
for (const name of names.sort()) {
  const source = path.join(sourceDir, name);
  try {
    const payload = parseStrictJson(await fs.readFile(source, "utf8"), source);
    if (name === "retrieval_example.json") validateRetrieval(payload, source);
    await atomicWriteJson(name, payload);
    retrievalInstalled ||= name === "retrieval_example.json";
    copied += 1;
  } catch (error) {
    // A malformed export should not poison the whole frontend build. Part 05
    // has a checked-in fallback below; other files keep their honest pending
    // state until their producer emits valid JSON.
    console.warn(`[data:sync] skipped ${name}: ${error.message}`);
  }
}

if (!retrievalInstalled) {
  const payload = validateRetrieval(
    parseStrictJson(await fs.readFile(retrievalSeed, "utf8"), retrievalSeed),
    retrievalSeed,
  );
  await atomicWriteJson("retrieval_example.json", payload);
  console.warn("[data:sync] installed deterministic retrieval fallback");
}

console.log(`[data:sync] copied ${copied} strict export(s) into ${targetDir}`);
