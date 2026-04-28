export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-panel/40">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-6 py-10 md:grid-cols-3">
        <div className="text-sm text-ink-muted">
          <div className="mb-2 font-semibold text-ink">Built for The Hartford</div>
          A self-contained portfolio demo for the GD08AE Data Scientist (GenAI) role.
          All real data is public (FMCSA, NTSB, SEC). Submissions are synthesized.
        </div>
        <div className="text-sm text-ink-muted">
          <div className="mb-2 font-semibold text-ink">Stack</div>
          <ul className="space-y-1 font-mono text-2xs">
            <li>Vertex AI · Gemini 2.0 Pro · OpenAI (judge)</li>
            <li>LangGraph · LangChain · Pydantic v2</li>
            <li>Chroma · BAAI/bge-large-en · BM25 + RRF + cross-encoder</li>
            <li>XGBoost · SHAP · scikit-learn isotonic</li>
            <li>FastAPI · Cloud Run · Docker · Cloud Build</li>
            <li>Next.js 15 · framer-motion · D3 · Three.js · Vercel</li>
          </ul>
        </div>
        <div className="text-sm text-ink-muted">
          <div className="mb-2 font-semibold text-ink">Contact</div>
          <ul className="space-y-1">
            <li>
              <a
                className="text-accent-400 underline-offset-4 hover:underline"
                href="mailto:23juliorod@gmail.com"
              >
                23juliorod@gmail.com
              </a>
            </li>
            <li>
              <a
                className="text-accent-400 underline-offset-4 hover:underline"
                href="https://juliooo.com"
                target="_blank"
                rel="noreferrer noopener"
              >
                juliooo.com
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
