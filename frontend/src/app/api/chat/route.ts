import crypto from "node:crypto";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL;
const HMAC_SECRET = process.env.HMAC_SECRET;
const RATE = parseInt(process.env.RATE_LIMIT_PER_HOUR ?? "20", 10);

// Tiny in-memory rate limiter; sufficient for a portfolio demo. Replace with
// Upstash Redis if you ever attract real traffic.
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return { allowed: true, remaining: RATE - 1 };
  }
  if (b.count >= RATE) return { allowed: false, remaining: 0 };
  b.count += 1;
  return { allowed: true, remaining: RATE - b.count };
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  const rl = rateLimit(ip);
  if (!rl.allowed) {
    return new Response("Rate limit hit. Try again in an hour.", { status: 429 });
  }

  const body = await req.text();

  if (!BACKEND_URL) {
    // Demo fallback — replays a canned event sequence so the page works
    // before / without Cloud Run.
    return demoStream(body);
  }

  const ts = Date.now().toString();
  const sig = HMAC_SECRET
    ? crypto.createHmac("sha256", HMAC_SECRET).update(ts + body).digest("hex")
    : "";

  const upstream = await fetch(`${BACKEND_URL}/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hartford-ts": ts,
      "x-hartford-sig": sig,
      "x-hartford-ratelimit-remaining": String(rl.remaining),
      accept: "text/event-stream",
    },
    body,
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function demoStream(rawBody: string): Response {
  let body: { message?: string; submission_id?: string } = {};
  try {
    body = JSON.parse(rawBody);
  } catch {}
  const msg = body.message ?? "Triage this submission";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: string, data: unknown) {
        const out = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(enc.encode(out));
      }
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const events: { d: number; ev: string; data: unknown }[] = [
        { d: 80, ev: "node_enter", data: { node: "parse_submission", t_ms: 80 } },
        { d: 220, ev: "node_exit", data: { node: "parse_submission", t_ms: 300 } },
        { d: 60, ev: "node_enter", data: { node: "enrich_carrier", t_ms: 360 } },
        { d: 400, ev: "tool_call", data: { id: "t1", name: "safer_lookup", input: { dot_number: body.submission_id ?? "2839412" } } },
        { d: 120, ev: "tool_result", data: { id: "t1", name: "safer_lookup", ms: 510, output: { legal_name: "ABC TRANSPORT INC", power_units: 214, oos_rate: { vehicle: 0.27, driver: 0.052 }, basic_violations: { hos: "above_threshold", driver_fitness: "below", vehicle_maint: "above" } } } },
        { d: 60, ev: "node_exit", data: { node: "enrich_carrier", t_ms: 950 } },
        { d: 30, ev: "node_enter", data: { node: "retrieve_context", t_ms: 980 } },
        { d: 200, ev: "citation", data: { ref: "[1]", doc_id: "ntsb-2020-08", snippet: "Driver experienced micro-sleep episodes consistent with cumulative fatigue. BASIC HoS Compliance score 47.2..." } },
        { d: 80, ev: "citation", data: { ref: "[2]", doc_id: "10k-knx-2023-rf", snippet: "Higher OOS rates and BASIC violations correlate with elevated claim severity in our recent loss experience..." } },
        { d: 80, ev: "node_exit", data: { node: "retrieve_context", t_ms: 1340 } },
        { d: 40, ev: "node_enter", data: { node: "analyze_loss_history", t_ms: 1380 } },
        { d: 60, ev: "tool_call", data: { id: "t2", name: "loss_calc", input: { loss_run_yrs: 5 } } },
        { d: 60, ev: "tool_result", data: { id: "t2", name: "loss_calc", ms: 95, output: { frequency_per_pu_per_yr: 0.044, severity_avg_usd: 89362, trend_3yr_pct: 14.7, loss_ratio_3yr: 0.71 } } },
        { d: 60, ev: "tool_call", data: { id: "t3", name: "xgb_loss_freq", input: { fleet: 214, oos: 0.27 } } },
        { d: 60, ev: "tool_result", data: { id: "t3", name: "xgb_loss_freq", ms: 28, output: { pred_claims_next_yr: 12.8, pi_80: [9.2, 16.7] } } },
        { d: 30, ev: "node_exit", data: { node: "analyze_loss_history", t_ms: 1700 } },
        { d: 30, ev: "node_enter", data: { node: "find_comparables", t_ms: 1730 } },
        { d: 80, ev: "node_exit", data: { node: "find_comparables", t_ms: 1850 } },
        { d: 30, ev: "node_enter", data: { node: "draft_memo", t_ms: 1880 } },
      ];

      for (const e of events) {
        await sleep(e.d);
        emit(e.ev, e.data);
      }

      // Stream the memo token-by-token
      const memo = `## Underwriting memo · ${body.submission_id ?? "DOT 2839412"} · ABC Transport Inc

**Recommendation:** Decline OR quote with significant surcharge + pre-binding loss-control inspection.

**Risk drivers**
- Vehicle maintenance OOS rate at 27% [1] — industry median is 12%.
- BASIC HoS Compliance score 62, above the FMCSA federal-intervention threshold [1].
- 3-yr loss ratio 0.71; trend +14.7%/yr.
- XGBoost loss-frequency predicts 12.8 claims next year (80% PI 9.2–16.7).

**Comparable accounts**
The closest 5 accounts in our synthetic book of business at this OOS rate and fleet size show a pricing surcharge of 22–38% over the base rate; one was non-renewed at 24 months.

**Producer-facing summary**
We can offer terms but pricing will reflect the elevated OOS exposure. A pre-binding fleet inspection and a written safety-program review by the carrier would be required for any sub-30% surcharge to be sustainable.`;

      for (const w of memo.split(/(\s+)/)) {
        await sleep(15 + Math.random() * 20);
        emit("token", { text: w });
      }
      emit("final", { memo, run_id: `demo-${Date.now()}` });
      controller.close();
      void msg;
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
