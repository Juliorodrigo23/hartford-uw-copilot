"use client";

import { useEffect, useState } from "react";
import { Copy, Check, FileCode2 } from "lucide-react";
import { codeToHtml } from "shiki";
import { cn } from "@/lib/cn";

type Props = {
  code: string;
  lang?: "python" | "tsx" | "ts" | "json" | "bash" | "yaml" | "dockerfile";
  fileName?: string;
  highlight?: number[]; // 1-indexed
  caption?: React.ReactNode;
  className?: string;
};

export function CodeBlock({ code, lang = "python", fileName, highlight = [], caption, className }: Props) {
  const [html, setHtml] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = await codeToHtml(code, {
        lang,
        theme: "github-dark-dimmed",
        transformers: [
          {
            line(node, line) {
              if (highlight.includes(line)) {
                node.properties.class = ((node.properties.class ?? "") + " line-highlight").trim();
              }
            },
          },
        ],
      });
      if (!cancelled) setHtml(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang, highlight]);

  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-border bg-bg-panel/60 px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-2xs text-ink-dim">
          <FileCode2 size={12} />
          {fileName ?? lang}
        </div>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="btn-ghost text-2xs"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div
        className="shiki-host overflow-x-auto text-sm"
        // shiki returns a self-contained pre> element
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style jsx global>{`
        .shiki-host pre {
          margin: 0;
          padding: 14px 16px;
          background: transparent !important;
          font-size: 12.5px;
          line-height: 1.55;
        }
        .shiki-host code .line {
          display: block;
          padding: 0 8px;
          border-left: 2px solid transparent;
          margin: 0 -8px;
        }
        .shiki-host code .line.line-highlight {
          background: rgba(220, 38, 38, 0.08);
          border-left-color: #dc2626;
        }
      `}</style>
      {caption && <div className="border-t border-border px-3 py-2 text-2xs text-ink-dim">{caption}</div>}
    </div>
  );
}
