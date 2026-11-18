"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Wand2, Scale, Radio } from "lucide-react";
import { SubmissionPicker, type ChatSubmission } from "@/components/chat/SubmissionPicker";
import { MessageStream, type Message } from "@/components/chat/MessageStream";
import { AgentTracePanel, type TraceEvent } from "@/components/chat/AgentTracePanel";
import { SuggestedPrompts } from "@/components/chat/SuggestedPrompts";
import { appPath } from "@/lib/api";
import { parseSSE } from "@/lib/sse";

type SignResponse = {
  demo?: boolean;
  backend_url?: string;
  ts?: string;
  sig?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

async function proxyChat(body: string, signal: AbortSignal, recordedReplay = false): Promise<Response> {
  const route = recordedReplay ? "/api/chat?replay=1" : "/api/chat";
  return fetch(appPath(route), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body,
    signal,
  });
}

/** Prefer the direct Cloud Run stream (no serverless duration ceiling), but
 * fall back to the same-origin Next route whenever signing, CORS, mixed
 * content, or direct connectivity prevents the browser request. */
async function openChatStream(
  body: string,
  signal: AbortSignal,
  recordedReplay = false,
): Promise<Response> {
  if (recordedReplay) return proxyChat(body, signal, true);

  let directFailure: string | null = null;

  try {
    const signRes = await fetch(appPath("/api/sign"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      signal,
    });
    if (!signRes.ok) {
      directFailure = `signing endpoint returned HTTP ${signRes.status}`;
    } else {
      const sign = (await signRes.json()) as SignResponse;
      if (sign.demo === true) {
        directFailure = "live backend is not configured; recorded-demo proxy selected";
      } else if (
        sign.demo === false &&
        typeof sign.backend_url === "string" &&
        typeof sign.ts === "string" &&
        typeof sign.sig === "string"
      ) {
        try {
          const backendUrl = new URL(sign.backend_url);
          if (backendUrl.protocol !== "http:" && backendUrl.protocol !== "https:") {
            throw new Error("signing endpoint returned an unsupported backend URL");
          }
          const direct = await fetch(new URL("chat", `${backendUrl.toString().replace(/\/+$/, "")}/`), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "text/event-stream",
              "x-hartford-ts": sign.ts,
              "x-hartford-sig": sign.sig,
            },
            body,
            signal,
          });
          // Auth failures happen before a graph run starts, so a proxy retry
          // is safe and helps when an intermediary strips custom headers.
          if (direct.status !== 401 && direct.status !== 403) return direct;
          directFailure = `direct backend returned HTTP ${direct.status}`;
        } catch (error: unknown) {
          if (isAbortError(error)) throw error;
          directFailure = `direct backend connection failed: ${errorMessage(error)}`;
        }
      } else {
        directFailure = "signing endpoint returned an invalid response";
      }
    }
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    directFailure = `signing request failed: ${errorMessage(error)}`;
  }

  try {
    return await proxyChat(body, signal);
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    throw new Error(
      `${directFailure ?? "Direct chat was unavailable"}; same-origin proxy also failed: ${errorMessage(error)}`,
    );
  }
}

async function responseError(res: Response): Promise<string> {
  const raw = (await res.text()).trim();
  if (!raw) return `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(raw) as { error?: string; detail?: unknown };
    const detail = typeof parsed.detail === "string" ? ` ${parsed.detail}` : "";
    return `${parsed.error ?? `HTTP ${res.status}`}${detail}`.trim();
  } catch {
    return raw.slice(0, 2_000);
  }
}

function samplePrompt(submission: ChatSubmission): string {
  return `Triage submission ${submission.id} (${submission.carrier_name}, DOT ${submission.dot_number}). Surface the top 3 risk drivers, recommend a disposition, and cite evidence.`;
}

type RunMode = "recorded" | "ready" | "connecting" | "live" | null;

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
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<RunMode>(null);
  const [demoSubmissionId, setDemoSubmissionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("demo")?.trim();
    if (requested) setDemoSubmissionId(requested);
  }, []);

  const selectSubmission = useCallback(
    (next: ChatSubmission) => {
      setSubmission(next);
      if (demoSubmissionId?.toLowerCase() === next.id.toLowerCase()) {
        // Prepare the sample prompt. The explicit replay query can launch the
        // recorded trace without making a live, potentially costly LLM call.
        setInput((current) => current.trim() || samplePrompt(next));
      }
    },
    [demoSubmissionId],
  );

  const send = useCallback(
    async (text: string, recordedReplay = false) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      setDemoNotice(null);
      setReviewNotice(null);
      setRunMode(recordedReplay ? "recorded" : "connecting");
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
        const body = JSON.stringify({
          submission_id: submission?.id,
          message: text,
          history: messages
            .filter((m) => !m.pending && m.text)
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.text })),
          critique_provider: critique === "auto" ? null : critique,
        });

        const res = await openChatStream(body, ac.signal, recordedReplay);
        if (!res.ok || !res.body) {
          setRunMode(null);
          const detail = await responseError(res);
          updateLast({
            role: "assistant",
            text: `Chat request failed (HTTP ${res.status}): ${detail}`,
            pending: false,
          });
          return;
        }

        let terminal = false;
        for await (const ev of parseSSE(res.body)) {
          if (ev.type === "demo_notice") {
            setDemoNotice(ev.message);
            setRunMode("recorded");
          } else if (ev.type === "node_enter") {
            if (!recordedReplay) setRunMode("live");
            setActive(ev.node);
            setTrace((t) => [...t, { kind: "node_enter", node: ev.node, t_ms: ev.t_ms }]);
          } else if (ev.type === "model_route") {
            setTrace((t) => [...t, { kind: "model_route", role: ev.role, provider: ev.provider, model: ev.model }]);
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
              { kind: "critique_judge", judge: ev.judge, iter: ev.iter, passed: ev.passed, error: ev.error, warning: ev.warning, gaps: ev.gaps },
            ]);
          } else if (ev.type === "redraft") {
            // The critique loop produced a new draft: clear the streamed
            // text so the fresh draft replaces the old one cleanly.
            updateLast((p) => ({ ...p, text: "" }));
          } else if (ev.type === "token") {
            updateLastByAppend(ev.text);
          } else if (ev.type === "final") {
            terminal = true;
            setReviewNotice(ev.reviewStatus === "unreviewed" ? "The memo is complete, but automated review was unavailable. Human review is required." : ev.reviewStatus === "needs_review" ? "The reviewer found unresolved gaps after the repair limit. Human review is required." : null);
            updateLast((prev) => ({ role: "assistant", text: ev.memo || prev.text, pending: false }));
            setActive(null);
          } else if (ev.type === "error") {
            terminal = true;
            setRunMode(null);
            updateLast({ role: "assistant", text: `Backend error: ${ev.message}`, pending: false });
          }
        }

        if (!terminal) throw new Error("The connection closed before analysis completed. Please retry.");

        // Stream closed. If nothing ever arrived (proxy timeout, backend
        // died mid-run), say so instead of leaving an empty bubble.
        updateLast((p) => ({
          ...p,
          pending: false,
          text:
            p.text ||
            "No response received — the stream closed before any tokens arrived. " +
              "Please retry the analysis.",
        }));
      } catch (e: unknown) {
        if (!isAbortError(e)) {
          setRunMode(null);
          const detail = errorMessage(e);
          updateLast((previous) => ({
            ...previous,
            text: previous.text
              ? `${previous.text}\n\n---\nConnection interrupted: ${detail}`
              : `Unable to reach the chat service: ${detail}`,
            pending: false,
          }));
        }
      } finally {
        setActive(null);
        updateLast((p) => ({ ...p, pending: false }));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, submission, critique, messages],
  );

  const replayStarted = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get("replay") !== "1" ||
      !submission ||
      replayStarted.current ||
      submission.id.toLowerCase() !== demoSubmissionId?.toLowerCase()
    ) {
      return;
    }
    replayStarted.current = true;
    void send(samplePrompt(submission), true);
  }, [demoSubmissionId, send, submission]);

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
    setDemoNotice(null);
    setReviewNotice(null);
    setRunMode(null);
  }

  function fillSubmissionPrompt() {
    if (!submission) return;
    setInput(samplePrompt(submission));
    prepareLiveInteraction();
  }

  function prepareLiveInteraction() {
    if (runMode !== "recorded") return;
    setDemoNotice(null);
    setRunMode("ready");
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
        displays the generated memo. The right panel shows the live LangGraph
          trace, tool calls (with input/output JSON), and citations. Every
          submission's DOT number resolves to a real FMCSA SAFER carrier profile.
        </p>
      </div>

      {reviewNotice && <div role="status" className="mb-4 rounded-md border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-sm text-warn-400">{reviewNotice}</div>}

      {runMode && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
            runMode === "recorded"
              ? "border-warn-500/40 bg-warn-500/10 text-warn-400"
              : runMode === "connecting"
                ? "border-info-500/40 bg-info-500/10 text-info-400"
                : "border-accent-500/40 bg-accent-500/10 text-accent-400"
          }`}
        >
          <Radio size={14} className="mt-0.5 shrink-0" />
          <span>
            {runMode === "recorded" && (
              <><strong>Recorded replay.</strong> {demoNotice ?? "Loading the saved agent trace…"}</>
            )}
            {runMode === "ready" && (
              <><strong>Ready for live analysis.</strong> Send your prompt to start a new agent run.</>
            )}
            {runMode === "connecting" && (
              <><strong>Connecting to the live agent…</strong> Opening the secured event stream.</>
            )}
            {runMode === "live" && (
              <><strong>We are live.</strong> This response and agent trace are streaming from the configured backend.</>
            )}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_320px]">
        {/* Left: submissions */}
        <div className="space-y-4">
          <SubmissionPicker
            selectedId={submission?.id ?? null}
            preferredId={demoSubmissionId}
            onSelect={selectSubmission}
          />
        </div>

        {/* Center: chat */}
        <div className="flex h-[640px] flex-col gap-3">
          <MessageStream messages={messages} citations={citations} />
          <SuggestedPrompts onPick={(p) => { setInput(p); prepareLiveInteraction(); }} />

          <div className="flex items-center gap-2 rounded-md border border-border bg-bg-card/60 px-2 py-1.5 text-2xs text-ink-muted">
            <Scale size={11} className="text-brand-400" />
            <span className="font-mono uppercase tracking-[0.16em] text-ink-dim">critique judge</span>
            <div className="ml-auto flex gap-1 rounded-md border border-border bg-bg-panel/60 p-0.5">
              {(["auto", "openai", "gemini"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { setCritique(v); prepareLiveInteraction(); }}
                  className={`rounded px-2 py-0.5 font-mono ${
                    critique === v ? "bg-bg-subtle text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {v === "openai" ? "OpenAI (cross-family)" : v === "gemini" ? "Gemini" : "auto"}
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
              onFocus={prepareLiveInteraction}
              onChange={(e) => { setInput(e.target.value); prepareLiveInteraction(); }}
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
          <AgentTracePanel events={trace} active={active} recorded={runMode === "recorded"} />
        </div>
      </div>
    </div>
  );
}
