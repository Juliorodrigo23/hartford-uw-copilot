/** Minimal SSE parser for the chat endpoint.
 * Server emits typed events:
 *   event: token          data: {"text": "..."}
 *   event: redraft        data: {"iter": 2}           ← clear memo, new draft incoming
 *   event: tool_call      data: {"name":"safer_lookup","input":{...}}
 *   event: tool_result    data: {"name":"safer_lookup","output":{...}}
 *   event: node_enter     data: {"node":"retrieve_context","t_ms":123}
 *   event: node_exit      data: {"node":"retrieve_context","t_ms":456}
 *   event: citation       data: {"ref":"[1]","doc_id":"...","snippet":"..."}
 *   event: critique_judge data: {"judge":"gpt-4o","iter":1,"passed":true,"error":null,"gaps":[]}
 *   event: demo_notice    data: {"message":"..."}     ← proxy replay mode, no live backend
 *   event: final          data: {"memo":"...","run_id":"..."}
 *   event: error          data: {"message":"..."}
 */
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "redraft"; iter: number }
  | { type: "tool_call"; name: string; input: unknown; id: string }
  | { type: "tool_result"; name: string; output: unknown; id: string; ms: number }
  | { type: "node_enter"; node: string; t_ms: number }
  | { type: "node_exit"; node: string; t_ms: number }
  | { type: "citation"; ref: string; docId: string; snippet: string }
  | { type: "critique_judge"; judge: string; iter: number; passed: boolean; error: string | null; gaps: string[] }
  | { type: "demo_notice"; message: string }
  | { type: "final"; memo: string; runId: string }
  | { type: "error"; message: string };

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // Flush a possibly buffered multi-byte UTF-8 character.
        buf += decoder.decode();
        break;
      }
      buf += decoder.decode(value, { stream: true });

      // The SSE specification permits CRLF, LF, and CR line endings.
      // sse-starlette emits CRLF by default, so searching only for `\n\n`
      // silently swallowed every live backend event.
      let boundary = findEventBoundary(buf);
      while (boundary) {
        const chunk = buf.slice(0, boundary.index);
        buf = buf.slice(boundary.index + boundary.length);
        const ev = parseChunk(chunk);
        if (ev) yield ev;
        boundary = findEventBoundary(buf);
      }
    }

    // Be tolerant of a server that closes after a final event without a
    // trailing blank line.
    if (buf.trim()) {
      const ev = parseChunk(buf);
      if (ev) yield ev;
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventBoundary(value: string): { index: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(value);
  return match ? { index: match.index, length: match[0].length } : null;
}

function parseChunk(chunk: string): ChatEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of chunk.split(/\r\n|\n|\r/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }
  const data = dataLines.join("\n");
  if (!data) return null;
  try {
    const obj = JSON.parse(data);
    switch (event) {
      case "token":
        return { type: "token", text: obj.text ?? "" };
      case "redraft":
        return { type: "redraft", iter: obj.iter ?? 0 };
      case "tool_call":
        return { type: "tool_call", name: obj.name, input: obj.input, id: obj.id };
      case "tool_result":
        return {
          type: "tool_result",
          name: obj.name,
          output: obj.output,
          id: obj.id,
          ms: obj.ms ?? 0,
        };
      case "node_enter":
        return { type: "node_enter", node: obj.node, t_ms: obj.t_ms ?? 0 };
      case "node_exit":
        return { type: "node_exit", node: obj.node, t_ms: obj.t_ms ?? 0 };
      case "citation":
        return { type: "citation", ref: obj.ref, docId: obj.doc_id, snippet: obj.snippet };
      case "critique_judge":
        return {
          type: "critique_judge",
          judge: obj.judge ?? "unknown",
          iter: obj.iter ?? 0,
          passed: obj.passed ?? true,
          error: obj.error ?? null,
          gaps: obj.gaps ?? [],
        };
      case "demo_notice":
        return { type: "demo_notice", message: obj.message ?? "demo replay" };
      case "final":
        return { type: "final", memo: obj.memo ?? "", runId: obj.run_id ?? "" };
      case "error":
        return { type: "error", message: obj.message ?? "unknown error" };
    }
  } catch {
    return null;
  }
  return null;
}
