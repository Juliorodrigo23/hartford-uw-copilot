import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { createHmac } from "node:crypto";

async function loadTS(file) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { parseSSE } = await loadTS("../src/lib/sse.ts");
const { guardChat } = await loadTS("../src/lib/chat-guard.ts");
async function parse(parts) {
  const stream = new ReadableStream({ start(c) { for (const part of parts) c.enqueue(part); c.close(); } });
  const events = [];
  for await (const event of parseSSE(stream)) events.push(event);
  return events;
}
const encode = (s) => new TextEncoder().encode(s);

for (const ending of ["\n", "\r\n", "\r"]) {
  test(`SSE handles ${JSON.stringify(ending)} and heartbeat comments`, async () => {
    const events = await parse([encode(`: heartbeat${ending}${ending}event: token${ending}data: {"text":"hello"}${ending}${ending}event: final${ending}data: {"memo":"hello","run_id":"r","review_status":"passed"}${ending}${ending}`)]);
    assert.deepEqual(events.map((e) => e.type), ["token", "final"]);
    assert.equal(events[1].reviewStatus, "passed");
  });
}
test("SSE handles split UTF-8 and split event boundaries", async () => {
  const bytes = encode('event: token\r\ndata: {"text":"café 🚛"}\r\n\r\n');
  const events = await parse(Array.from(bytes, (byte) => new Uint8Array([byte])));
  assert.equal(events[0].text, "café 🚛");
});
test("SSE retains routing, fallback warnings, and terminal errors", async () => {
  const events = await parse([encode('event: model_route\ndata: {"role":"draft","provider":"gemini","model":"example"}\n\nevent: critique_judge\ndata: {"judge":"gemini","passed":true,"warning":"fallback"}\n\nevent: error\ndata: {"message":"failed"}')]);
  assert.equal(events[0].model, "example");
  assert.equal(events[1].warning, "fallback");
  assert.equal(events[2].type, "error");
});
function request(body, ip) { return new Request("http://localhost/api/sign", { method: "POST", headers: { "x-forwarded-for": ip }, body }); }
test("signing rejects invalid JSON, oversized prompts, and invalid provider", async () => {
  for (const body of ['bad', '{"message":""}', JSON.stringify({ message: "a".repeat(12001) }), '{"message":"Triage","critique_provider":"unknown"}']) {
    const response = await guardChat(request(body, crypto.randomUUID()));
    assert.equal(response.status, 422);
  }
});
test("signing preserves the exact request bytes for HMAC", async () => {
  const body = '{ "message": "Triage", "critique_provider": "openai" }';
  assert.equal((await guardChat(request(body, "valid"))).body, body);
});
test("the signing path is rate limited", async () => {
  const ip = crypto.randomUUID();
  let response;
  for (let i = 0; i < 21; i++) response = await guardChat(request('{"message":"Triage"}', ip));
  assert.equal(response.status, 429);
});

const { GET: getRun } = await loadTS("../src/app/api/runs/[runId]/route.ts");
test("package reads sign the exact empty GET body and return the saved run", async () => {
  const previousFetch = globalThis.fetch;
  const previousBackend = process.env.BACKEND_URL;
  const previousSecret = process.env.HMAC_SECRET;
  process.env.BACKEND_URL = "https://backend.example";
  process.env.HMAC_SECRET = "test-secret";
  let called;
  globalThis.fetch = async (url, options) => {
    called = { url: String(url), options };
    return Response.json({ run_id: "a".repeat(32), values: { memo_md: "Complete memo" } });
  };
  try {
    const response = await getRun(new Request("http://localhost/api/runs/test"), { params: Promise.resolve({ runId: "a".repeat(32) }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).values.memo_md, "Complete memo");
    assert.equal(called.url, `https://backend.example/traces/${"a".repeat(32)}`);
    const tsValue = called.options.headers["x-hartford-ts"];
    assert.equal(called.options.headers["x-hartford-sig"], createHmac("sha256", "test-secret").update(tsValue).digest("hex"));
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBackend === undefined) delete process.env.BACKEND_URL; else process.env.BACKEND_URL = previousBackend;
    if (previousSecret === undefined) delete process.env.HMAC_SECRET; else process.env.HMAC_SECRET = previousSecret;
  }
});
test("package reads reject invalid run paths before network access", async () => {
  const response = await getRun(new Request("http://localhost/api/runs/test"), { params: Promise.resolve({ runId: "../../private" }) });
  assert.equal(response.status, 400);
});
test("all saved packages include their full broker note and annual losses", () => {
  const packets = JSON.parse(readFileSync(new URL("./submissions.seed.json", import.meta.url), "utf8"));
  const schema = JSON.parse(readFileSync(new URL("./submission.schema.json", import.meta.url), "utf8"));
  assert.equal(packets.submissions.length, 30);
  assert.equal(new Set(packets.submissions.map((s) => s.id)).size, 30);
  assert.ok(schema.required.includes("loss_run"));
  for (const submission of packets.submissions) {
    assert.ok(submission.broker_email.length > 0);
    assert.ok(submission.loss_run.length > 0);
    assert.ok(submission._safer_snapshot.legal_name);
    assert.ok(submission.loss_run.every((y) => Number.isFinite(Number(y.incurred_usd)) && y.claims >= 0));
  }
});
