"use client";

import { useCallback, useRef, useState } from "react";
import { Send, RotateCcw, Wand2, Scale, Radio } from "lucide-react";
import { SubmissionPicker, type ChatSubmission } from "@/components/chat/SubmissionPicker";
import { MessageStream, type Message } from "@/components/chat/MessageStream";
import { AgentTracePanel, type TraceEvent } from "@/components/chat/AgentTracePanel";
import { SuggestedPrompts } from "@/components/chat/SuggestedPrompts";
import { parseSSE } from "@/lib/sse";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/hartford";

export default function ChatPage() {
  const [submission, setSubmission] = useState<ChatSubmission | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [citations, setCitations] = useState<{ ref: string; doc_id: string; snippet: string }[]>([]);
  const [critique, setCritique] = useState<"auto" | "openai" | "gemini">("auto");
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      setInput("");
      const userMsg: Message = { role: "user", text };
      const placeholder: Message = { role: "assistant", text: "", pending: true };
      setMessages((m) => [...m, userMsg, placeholder]);
      setTrace([]);
      setActive(null);
      setCitations([]);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch(`${basePath}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submission_id: submission?.id,
            message: text,
            history: messages
              .filter((m) => !m.pending && m.text)
              .slice(-6)
              .map((m) => ({ role: m.role, content: m.text })),
            critique_provider: critique === "auto" ? null : critique,
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const m = await res.text();
          updateLast({ role: "assistant", text: `Upstream error: ${m}`, pending: false });
          setBusy(false);
          return;
        }

        for await (const ev of parseSSE(res.body)) {
          if (ev.type === "demo_notice") {
            setDemoNotice(ev.message);
          } else if (ev.type === "node_enter") {
            setActive(ev.node);
            setTrace((t) => [...t, { kind: "node_enter", node: ev.node, t_ms: ev.t_ms }]);
          } else if (ev.type === "node_exit") {
            setTrace((t) => [...t, { kind: "node_exit", node: ev.node, t_ms: ev.t_ms }]);
          } else if (ev.type === "tool_call") {
            setTrace((t) => [...t, { kind: "tool_call", id: ev.id, name: ev.name, input: ev.input }]);
          } else if (ev.type === "tool_result") {
            setTrace((t) => [...t, { kind: "tool_result", id: ev.id, name: ev.name, output: ev.output, ms: ev.ms }]);
          } else if (ev.type === "citation") {
            setCitations((c) => [...c, { ref: ev.ref, doc_id: ev.docId, snippet: ev.snippet }]);
            setTrace((t) => [...t, { kind: "citation", ref: ev.ref, doc_id: ev.docId, snippet: ev.snippet }]);
          } else if (ev.type === "critique_judge") {
            setTrace((t) => [
              ...t,
              { kind: "critique_judge", judge: ev.judge, iter: ev.iter, passed: ev.passed, error: ev.error, gaps: ev.gaps },
            ]);
          } else if (ev.type === "redraft") {
            // The critique loop produced a new draft: clear the streamed
            // text so the fresh draft replaces the old one cleanly.
            updateLast((p) => ({ ...p, text: "" }));
          } else if (ev.type === "token") {
            updateLastByAppend(ev.text);
          } else if (ev.type === "final") {
            updateLast((prev) => ({ role: "assistant", text: ev.memo || prev.text, pending: false }));
            setActive(null);
          } else if (ev.type === "error") {
            updateLast({ role: "assistant", text: `Backend error: ${ev.message}`, pending: false });
          }
        }

        // Stream closed. If nothing ever arrived (proxy timeout, backend
        // died mid-run), say so instead of leaving an empty bubble.
        updateLast((p) => ({
          ...p,
          pending: false,
          text:
            p.text ||
            "No response received — the stream closed before any tokens arrived. " +
              "Usually this means the backend run timed out or errored mid-stream; " +
              "check the Cloud Run logs (gcloud run services logs read uw-copilot-backend --region us-central1).",
        }));
      } catch (e: unknown) {
        const errAny = e as { name?: string; message?: string };
        if (errAny?.name !== "AbortError") {
          updateLast({ role: "assistant", text: `Network error: ${errAny.message ?? String(e)}`, pending: false });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, submission, critique, messages],
  );

  function updateLast(patch: Message | ((prev: Message) => Message)) {
    setMessages((ms) => {
      const out = [...ms];
      if (!out.length) return out;
      const last = out[out.length - 1];
      out[out.length - 1] = typeof patch === "function" ? (patch as (p: Message) => Message)(last) : patch;
      return out;
    });
  }
  function updateLastByAppend(piece: string) {
    setMessages((ms) => {
      const out = [...ms];
      if (!out.length) return out;
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, text: (last.text || "") + piece };
      return out;
    });
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setTrace([]);
    setActive(null);
    setCitations([]);
  }

  function fillSubmissionPrompt() {
    if (!submission) return;
    setInput(
      `Triage submission ${submission.id} (${submission.carrier_name}, DOT ${submission.dot_number}). Surface the top 3 risk drivers, recommend a disposition, and cite evidence.`,
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="mb-4">
        <div className="section-eyebrow">Live demo</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Underwriting copilot
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Pick a submission on the left to bind it as context. The middle panel
          streams tokens as they arrive. The right panel shows the live LangGraph
          trace, tool calls (with input/output JSON), and citations. Every
          submission's DOT number resolves to a real FMCSA SAFER carrier profile.
        </p>
      </div>

      {demoNotice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-sm text-warn-400">
          <Radio size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Recorded replay.</strong> {demoNotice}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_320px]">
        {/* Left: submissions */}
        <div className="space-y-4">
          <SubmissionPicker selectedId={submission?.id ?? null} onSelect={setSubmission} />
        </div>

        {/* Center: chat */}
        <div className="flex h-[640px] flex-col gap-3">
          <MessageStream messages={messages} citations={citations} />
          <SuggestedPrompts onPick={(p) => setInput(p)} />

          <div className="flex items-center gap-2 rounded-md border border-border bg-bg-card/60 px-2 py-1.5 text-2xs text-ink-muted">
            <Scale size={11} className="text-brand-400" />
            <span className="font-mono uppercase tracking-[0.16em] text-ink-dim">critique judge</span>
            <div className="ml-auto flex gap-1 rounded-md border border-border bg-bg-panel/60 p-0.5">
              {(["auto", "openai", "gemini"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setCritique(v)}
                  className={`rounded px-2 py-0.5 font-mono ${
                    critique === v ? "bg-bg-subtle text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {v === "openai" ? "GPT-4o (cross-family)" : v === "gemini" ? "Gemini Flash" : "auto"}
                </button>
              ))}
            </div>
          </div>

          <div className="card flex items-center gap-2 p-2">
            {submission && (
              <button
                onClick={fillSubmissionPrompt}
                className="btn-ghost text-2xs whitespace-nowrap"
                title={`Use ${submission.id}`}
              >
                <Wand2 size={12} /> {submission.id}
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={
                submission
                  ? `Ask about ${submission.carrier_name}…`
                  : "Ask the agent — pick a submission for richer answers"
              }
              className="flex-1 bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-ink-dim"
            />
            <button
              onClick={() => reset()}
              className="btn-ghost"
              title="Clear conversation"
              disabled={busy && messages.length === 0}
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || busy}
              className="btn-primary disabled:opacity-50"
            >
              <Send size={14} /> {busy ? "thinking…" : "send"}
            </button>
          </div>
        </div>

        {/* Right: trace */}
        <div className="h-[640px] overflow-y-auto">
          <AgentTracePanel events={trace} active={active} />
        </div>
      </div>
    </div>
  );
}
