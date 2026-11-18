"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { Loader2, User, Bot } from "lucide-react";

export type Message = {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
};

export function MessageStream({
  messages,
  citations,
}: {
  messages: Message[];
  citations: { ref: string; doc_id: string; snippet: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div
      ref={ref}
      className="card flex-1 space-y-4 overflow-y-auto p-5"
    >
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center text-center text-sm text-ink-dim">
          Pick a submission on the left, or ask a free-form question. The agent
          will run end-to-end and stream tokens here while the trace updates on
          the right.
        </div>
      )}
      {messages.map((m, i) => (
        <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
          {m.role === "assistant" && (
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-700/60 bg-brand-700/15 text-brand-400">
              <Bot size={14} />
            </div>
          )}
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`max-w-[78%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
              m.role === "user"
                ? "bg-brand-700/15 text-ink"
                : "border border-border bg-bg-card text-ink"
            }`}
          >
            {m.role === "assistant" ? renderMemo(m.text, citations) : <p>{m.text}</p>}
            {m.pending && (
              <div className="mt-2 flex items-center gap-2 font-mono text-2xs text-ink-dim">
                <Loader2 size={11} className="animate-spin" />
                streaming…
              </div>
            )}
          </motion.div>
          {m.role === "user" && (
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg-card text-ink-muted">
              <User size={14} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Lightweight Markdown-ish renderer: preserves headings, bullets, bold, code,
// and turns `[1]` references into hover-able citation chips. Avoids pulling
// in a full md parser.
export function MemoContent({ text, citations }: { text: string; citations: { ref: string; snippet?: string }[] }) {
  return renderMemo(text, citations);
}

function renderMemo(text: string, citations: { ref: string; snippet?: string }[]) {
  const lines = text.split("\n");
  const els: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  let code: string[] | null = null;
  function flushBullets() {
    if (bullets.length) {
      els.push(
        <ul key={`b-${els.length}`} className="my-2 list-disc space-y-1 pl-5 text-ink">
          {bullets}
        </ul>,
      );
      bullets = [];
    }
  }

  for (const [i, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      flushBullets();
      if (code !== null) {
        els.push(<pre key={i} className="my-3 overflow-x-auto rounded-md border border-border bg-bg-panel p-3 font-mono text-xs">{code.join("\n")}</pre>);
        code = null;
      } else code = [];
    } else if (code !== null) {
      code.push(raw);
    } else if (line === "---") {
      flushBullets();
      els.push(<hr key={i} className="my-4 border-border" />);
    } else if (line.startsWith("## ")) {
      flushBullets();
      els.push(
        <h3 key={i} className="mt-3 text-base font-semibold text-ink">
          {decorate(line.slice(3), citations)}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      flushBullets();
      els.push(
        <h2 key={i} className="mt-3 text-lg font-semibold text-ink">
          {decorate(line.slice(2), citations)}
        </h2>,
      );
    } else if (/^[-*] /.test(line)) {
      bullets.push(<li key={i}>{decorate(line.slice(2), citations)}</li>);
    } else if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
      flushBullets();
      els.push(
        <p key={i} className="mt-2 font-semibold text-ink">
          {line.slice(2, -2)}
        </p>,
      );
    } else if (line === "") {
      flushBullets();
      els.push(<div key={i} className="h-1" />);
    } else {
      flushBullets();
      els.push(
        <p key={i} className="text-ink">
          {decorate(line, citations)}
        </p>,
      );
    }
  }
  flushBullets();
  if (code !== null) els.push(<pre key="unfinished-code" className="overflow-x-auto font-mono text-xs">{code.join("\n")}</pre>);
  return els;
}

function decorate(line: string, citations: { ref: string; snippet?: string }[]) {
  // Replace **bold** and `code` and [n] references in order.
  const tokens: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) tokens.push(line.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) {
      tokens.push(
        <strong key={key++} className="text-ink">
          {t.slice(2, -2)}
        </strong>,
      );
    } else if (t.startsWith("`")) {
      tokens.push(
        <code key={key++} className="rounded bg-bg-subtle px-1 font-mono text-[0.85em]">
          {t.slice(1, -1)}
        </code>,
      );
    } else {
      const has = citations.some((c) => c.ref === t);
      tokens.push(
        <sup
          key={key++}
          className={`mx-0.5 cursor-default rounded px-1 font-mono text-[10px] ${
            has ? "bg-info-500/20 text-info-400" : "text-ink-dim"
          }`}
          title={citations.find((c) => c.ref === t)?.snippet ?? (has ? "see evidence panel for citation" : "citation not yet streamed")}
        >
          {t}
        </sup>,
      );
    }
    last = m.index + t.length;
  }
  if (last < line.length) tokens.push(line.slice(last));
  return tokens;
}
