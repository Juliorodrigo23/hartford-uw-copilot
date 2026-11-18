import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!/^[a-f0-9]{32}$/.test(runId)) return Response.json({ error: "Invalid run ID." }, { status: 400 });
  const backend = process.env.BACKEND_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.HMAC_SECRET;
  if (!backend || !secret) return Response.json({ error: "Live packages are not configured." }, { status: 503 });
  let url: URL;
  try {
    url = new URL(`${backend}/traces/${runId}`);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error();
  } catch {
    return Response.json({ error: "The package service is not configured." }, { status: 503 });
  }
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", secret).update(ts).digest("hex");
  try {
    const result = await fetch(url, { headers: { "x-hartford-ts": ts, "x-hartford-sig": sig }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!result.ok) return Response.json({ error: result.status === 404 ? "This run is no longer available. Run a new analysis to create a fresh package." : "The package could not be loaded." }, { status: result.status, headers: { "cache-control": "no-store" } });
    return Response.json(await result.json(), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "The package service could not be reached." }, { status: 502 });
  }
}
