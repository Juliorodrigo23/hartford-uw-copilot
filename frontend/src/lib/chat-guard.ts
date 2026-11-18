// Shared by direct-stream signing and the same-origin proxy. Signing grants
// access to paid inference, so it must have the same bounds and rate limit.
const configuredRate = Number.parseInt(process.env.RATE_LIMIT_PER_HOUR ?? "20", 10);
const RATE = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

export async function guardChat(req: Request): Promise<Response | { body: string; remaining: number }> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= 10000) {
      for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
      if (buckets.size >= 10000) buckets.delete(buckets.keys().next().value!);
    }
    bucket = { count: 0, resetAt: now + 3600000 };
    buckets.set(ip, bucket);
  }
  if (bucket.count >= RATE) {
    return Response.json({ error: "Rate limit hit. Please try again later." }, { status: 429, headers: { "retry-after": String(Math.ceil((bucket.resetAt - now) / 1000)) } });
  }
  bucket.count += 1;
  const body = await req.text();
  if (new TextEncoder().encode(body).length > 160000) {
    return Response.json({ error: "The request is too large." }, { status: 413 });
  }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value.message !== "string" || !value.message.trim() || value.message.length > 12000) throw new Error();
    if (value.critique_provider != null && !["openai", "gemini"].includes(value.critique_provider)) throw new Error();
    if (value.history != null && (!Array.isArray(value.history) || value.history.length > 12 || value.history.some((turn: { role?: unknown; content?: unknown }) => !turn || !["user", "assistant"].includes(String(turn.role)) || typeof turn.content !== "string" || turn.content.length > 12000))) throw new Error();
  } catch {
    return Response.json({ error: "Invalid chat request." }, { status: 422 });
  }
  return { body, remaining: RATE - bucket.count };
}
