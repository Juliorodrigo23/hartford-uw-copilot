import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { guardChat } from "@/lib/chat-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HMAC signing endpoint for DIRECT browser → Cloud Run streaming.
 *
 * Why: proxying the SSE stream through a Vercel function put a hard
 * duration ceiling in the middle of every agent run (cold start + retrieval
 * + a 30-60s memo > the function window), which killed streams with zero
 * events delivered. Instead, the browser asks this endpoint to sign the
 * EXACT request body, then talks to Cloud Run directly; the function
 * returns in milliseconds and the stream has no middleman.
 *
 * The signature covers ts + body with a 5-minute replay window (verified in
 * backend/app/api/auth.py), and the backend applies its own per-IP rate
 * limit, so exposing the backend URL costs nothing the proxy didn't already
 * allow.
 */

const BACKEND_URL = process.env.BACKEND_URL?.trim().replace(/\/+$/, "");
const HMAC_SECRET = process.env.HMAC_SECRET;

export async function POST(req: NextRequest) {
  const guarded = await guardChat(req);
  if (guarded instanceof Response) return guarded;
  if (!BACKEND_URL) {
    // No live backend configured — tell the client to use the recorded
    // demo replay served by /api/chat.
    return Response.json({ demo: true }, { headers: { "cache-control": "no-store" } });
  }
  if (!HMAC_SECRET) return Response.json({ error: "Live chat signing is not configured." }, { status: 503 });
  let backendUrl: URL;
  try {
    backendUrl = new URL(BACKEND_URL);
    if (backendUrl.protocol !== "http:" && backendUrl.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    return Response.json(
      { error: "Server configuration error: BACKEND_URL must be an http(s) URL." },
      { status: 503 },
    );
  }
  const { body } = guarded;
  const ts = Date.now().toString();
  const sig = HMAC_SECRET
    ? crypto.createHmac("sha256", HMAC_SECRET).update(ts + body).digest("hex")
    : "";
  return Response.json(
    { demo: false, backend_url: backendUrl.toString().replace(/\/+$/, ""), ts, sig },
    { headers: { "cache-control": "no-store" } },
  );
}
