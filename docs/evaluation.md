# Evidence benchmark v2

Run `cd backend && uv run python scripts/07_run_evals.py`. The runner evaluates
20 frozen synthetic submission packets against a single-shot complete-packet
baseline, validates 20 retrieval questions, publishes datasets/experiments and
per-run feedback to LangSmith, and exports the dashboard JSON. `--limit 1` is
an explicitly labeled smoke test; `--no-publish` disables remote publication.
Concurrency defaults to two. Completed results are cached by code, corpus,
reference, model configuration and execution-platform fingerprints. A retried
job can resume from completed LangSmith traces with published feedback.

## Reference quality and scope

The cases contain the actual complete synthetic submission, original public
snapshot and frozen SAFER profile. Their content hashes are checked before
execution. Runtime refresh cannot silently alter the input packet. Fourteen
cases are development examples and six are held out by carrier identity.
Reference assertions describe checkable observations and evidence limitations,
not expert-approved actuarial dispositions. Twenty synthetic packets do not
establish real-world underwriting accuracy.

Retrieval labels were inspected against their source text. Every positive label
has a quotation and content hash; a missing/changed source or unconfirmed draft
label fails validation. Overlapping chunks count as equivalent only when the
specified quotation exists in the same source document. Eighteen questions have
supporting passages; two require no-source behavior because licensed forms are
absent. Corpus coverage is reported explicitly. Eight source-linked public FMCSA
excerpts supplement BM25; they are not newly embedded dense vectors or policy
forms. Source URLs, retrieval dates and excerpt hashes are tracked.

All references are labeled **agent source checked; underwriter validation
pending**. Expert confirmation and a larger independent sample remain necessary.
The v1 reference files are archived for provenance. Their draft/keyword metrics
are not directly comparable with v2. The older keyword evaluators remain legacy
code paths; the default CLI uses the v2 runner exclusively.

## Scoring

- **Evidence assertion coverage:** correctly covered reference assertions divided
  by all reference assertions across completed cases. The evaluator accepts
  paraphrases/rounding and rejects contradicted or negated assertions.
- **Unsupported factual-claim rate:** unsupported material factual claims divided
  by all material factual claims the evaluator checked. Requests and explicit
  conditional scenarios are not asserted facts. This is an LLM assessment with
  saved reasons, not exhaustive proof that no hallucination exists.
- **Citation validity:** referenced numeric citation occurrences whose IDs exist
  divided by all such occurrences. No citations yields null, not an automatic
  pass. Valid IDs alone do not prove that their passages support a claim; support
  is assessed against complete evidence by the evaluator.
- **Format validity:** the final JSON has a valid disposition label, confidence
  and drivers. Missing/malformed output fails this check.
- **Completion:** expected and completed cases, failures, development and holdout
  results are reported separately. Failed cases are never converted to fake
  successful memos or hidden from the denominator of completion.

The baseline and agent use the same generator and frozen raw account packet.
The agent additionally uses analytical tools, scoped retrieval and critique.
Both are graded with the same evidence-aware GPT-4o rubric and assertions.
Scores retain individual reasons, provider traces and reference example links.
No pairwise win rate or component-ablation delta is inferred from these scores.
The reviewer and evaluator use the same configured OpenAI model; human checks
are needed to assess shared judge bias.

## Full-packet context and document follow-ups

Gemini and the runtime reviewer receive the same full evidence JSON: complete
broker note, annual loss rows, original snapshot, current profile, calculated
statistics, model provenance, comparables, full retrieved passages and a document
inventory. Packet hashes make this checkable in traces. No provider key is part
of that object. Broker/document text is evidence, never model instructions.

Missing verified documents are distinct from memo errors. The reviewer can pass
memo quality while listing broker documents still required; the account remains
`needs_review` and the UI shows those follow-ups. A new draft is reserved for
fixable memo/evidence problems. Annual synthetic aggregates are never described
as verified carrier loss documents or invented individual claim files.

References: [LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation-concepts)
and [dataset management](https://docs.langchain.com/langsmith/manage-datasets-programmatically).
