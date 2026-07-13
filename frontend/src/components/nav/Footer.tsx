export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-panel/40">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-6 py-10 md:grid-cols-3">
        <div className="text-sm text-ink-muted">
          <div className="mb-2 font-semibold text-ink">Commercial Insurance Agentic Analyzer</div>
          A production-shaped portfolio system for observable underwriting decision support.
          Public evidence comes from FMCSA, NTSB, and SEC sources; submission packets are synthesized.
        </div>
        <div className="text-sm text-ink-muted">
          <div className="mb-2 font-semibold text-ink">Stack</div>
          <ul className="space-y-1 font-mono text-2xs">
            <li>Vertex AI · Gemini 2.5 Pro · OpenAI (judge)</li>
            <li>LangGraph · LangChain · Pydantic v2</li>
            <li>Chroma · BAAI/bge-large-en · BM25 + RRF + cross-encoder</li>
            <li>XGBoost · SHAP · scikit-learn isotonic</li>
            <li>FastAPI · Cloud Run · Docker · Cloud Build</li>
            <li>Next.js 15 · framer-motion · D3 · Three.js · Vercel</li>
          </ul>
        </div>
        <div className="text-sm text-ink-muted">
          <div className="mb-2 font-semibold text-ink">Julio Contreras</div>
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
            <li>
              <a
                className="text-accent-400 underline-offset-4 hover:underline"
                href="https://www.linkedin.com/in/juliooocon/"
                target="_blank"
                rel="noreferrer noopener"
              >
                LinkedIn
              </a>
            </li>
            <li>
              <a
                className="text-accent-400 underline-offset-4 hover:underline"
                href="https://github.com/Juliorodrigo23"
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                className="text-accent-400 underline-offset-4 hover:underline"
                href="https://scholar.google.com/citations?user=UvH6Ua4AAAAJ"
                target="_blank"
                rel="noreferrer noopener"
              >
                Google Scholar
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
