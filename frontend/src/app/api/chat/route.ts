import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { guardChat } from "@/lib/chat-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full agent run (parse → SAFER → retrieve → draft → critique → finalize)
// takes 20-60s. Without this, Vercel kills the function at the plan default
// (~10-15s) and the SSE stream dies silently mid-run: the UI shows
// "streaming…" forever and then an empty message. Vercel clamps this to
// your plan's maximum.
export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL?.trim().replace(/\/+$/, "");
const HMAC_SECRET = process.env.HMAC_SECRET;

export async function POST(req: NextRequest) {
  // Recruiter walkthroughs can request the clearly labeled recorded trace
  // even when a live backend is configured. This keeps the landing CTA
  // deterministic, instant, and free of accidental model spend.
  if (req.nextUrl.searchParams.get("replay") === "1") {
    return demoStream("walkthrough");
  }

  const guarded = await guardChat(req);
  if (guarded instanceof Response) return guarded;
  const { body } = guarded;
  const rl = { remaining: guarded.remaining };

  if (!BACKEND_URL) {
    // No backend configured: stream a RECORDED REPLAY. The stream announces
    // itself with a demo_notice event and the UI shows a persistent banner —
    // it is never presented as a live agent run.
    return demoStream("backend-unconfigured");
  }
  if (!HMAC_SECRET) return Response.json({ error: "Live chat signing is not configured." }, { status: 503 });

  const ts = Date.now().toString();
  const sig = HMAC_SECRET
    ? crypto.createHmac("sha256", HMAC_SECRET).update(ts + body).digest("hex")
    : "";

  let chatUrl: URL;
  try {
    chatUrl = new URL(`${BACKEND_URL}/chat`);
    if (chatUrl.protocol !== "http:" && chatUrl.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    return Response.json(
      { error: "Server configuration error: BACKEND_URL must be an http(s) URL." },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hartford-ts": ts,
        "x-hartford-sig": sig,
        accept: "text/event-stream",
      },
      body,
      cache: "no-store",
      signal: req.signal,
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json(
      { error: "The chat backend could not be reached.", detail },
      {
        status: 502,
        headers: { "x-hartford-ratelimit-remaining": String(rl.remaining) },
      },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 2_000);
    return Response.json(
      { error: `Chat backend returned HTTP ${upstream.status}.`, detail },
      {
        status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
        headers: {
          "x-hartford-ratelimit-remaining":
            upstream.headers.get("x-hartford-ratelimit-remaining") ?? String(rl.remaining),
        },
      },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-hartford-ratelimit-remaining":
        upstream.headers.get("x-hartford-ratelimit-remaining") ?? String(rl.remaining),
    },
  });
}

function demoStream(reason: "walkthrough" | "backend-unconfigured"): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: string, data: unknown) {
        const out = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(enc.encode(out));
      }
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      emit("demo_notice", {
        message:
          reason === "walkthrough"
            ? "You are viewing the saved recruiter walkthrough. Choose a prompt or type a message to switch to a new live agent run."
            : "No live backend is configured (BACKEND_URL unset). This is a recorded replay of the event protocol with synthetic example data — not a live agent run.",
      });

      const events: { d: number; ev: string; data: unknown }[] = [
        { d: 80, ev: "node_enter", data: { node: "parse_submission", t_ms: 80 } },
        { d: 220, ev: "node_exit", data: { node: "parse_submission", t_ms: 300 } },
        { d: 60, ev: "node_enter", data: { node: "enrich_carrier", t_ms: 360 } },
        { d: 400, ev: "tool_call", data: { id: "t1", name: "safer_lookup", input: { dot_number: "0000000 (demo)" } } },
        { d: 120, ev: "tool_result", data: { id: "t1", name: "safer_lookup", ms: 510, output: { legal_name: "DEMO CARRIER (SYNTHETIC)", power_units: 214, oos_rate: { vehicle: 0.27, driver: 0.052 } } } },
        { d: 60, ev: "node_exit", data: { node: "enrich_carrier", t_ms: 950 } },
        { d: 30, ev: "node_enter", data: { node: "retrieve_context", t_ms: 980 } },
        { d: 200, ev: "citation", data: { ref: "[1]", doc_id: "demo-doc-1", snippet: "(synthetic replay snippet — run the live backend to see real NTSB/10-K citations)" } },
        { d: 80, ev: "node_exit", data: { node: "retrieve_context", t_ms: 1340 } },
        { d: 40, ev: "node_enter", data: { node: "analyze_loss_history", t_ms: 1380 } },
        { d: 60, ev: "tool_call", data: { id: "t2", name: "loss_calc", input: { loss_run_yrs: 5 } } },
        { d: 60, ev: "tool_result", data: { id: "t2", name: "loss_calc", ms: 95, output: { frequency_per_pu_per_yr: 0.044, severity_avg_usd: 89362, trend_3yr_pct: 14.7, loss_ratio_3yr: 0.71 } } },
        { d: 30, ev: "node_exit", data: { node: "analyze_loss_history", t_ms: 1700 } },
        { d: 30, ev: "node_enter", data: { node: "find_comparables", t_ms: 1730 } },
        { d: 80, ev: "node_exit", data: { node: "find_comparables", t_ms: 1850 } },
        { d: 30, ev: "node_enter", data: { node: "draft_memo", t_ms: 1880 } },
      ];

      for (const e of events) {
        await sleep(e.d);
        emit(e.ev, e.data);
      }

      const replayExplanation = reason === "walkthrough"
        ? "**This is the saved walkthrough, not a live agent run.** Send any new prompt to switch to the configured live backend."
        : "**This is not a live agent run.** Deploy the backend and set BACKEND_URL to stream real memos with real SAFER data, real retrieval citations, and the trained loss-frequency model.";
      const memo = `## Underwriting memo · recorded demo replay

${replayExplanation}

**What the live system does with a submission like this one:**
- Pulls the carrier's real FMCSA SAFER profile (crash counts, OOS rates) [1]
- Retrieves NTSB narratives and 10-K risk factors via hybrid BM25 + dense search
- Computes loss-run statistics and an XGBoost next-year claim-frequency prediction
- Drafts, self-critiques against a rubric (GPT-4o cross-family judge), and finalizes`;

      for (const w of memo.split(/(\s+)/)) {
        await sleep(12);
        emit("token", { text: w });
      }
      emit("final", { memo, run_id: `demo-${Date.now()}` });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
