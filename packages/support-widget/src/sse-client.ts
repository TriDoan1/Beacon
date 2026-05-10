/**
 * Minimal SSE parser for fetch-based streams. The browser's native EventSource
 * doesn't allow custom request headers, so we consume the response body
 * manually. Each SSE frame is separated by "\n\n" and looks like:
 *
 *   id: 7
 *   event: text
 *   data: {"delta":"hello"}
 *
 * We only handle event/data/id (no retry/comments — the server doesn't emit
 * them today). If the server starts sending multi-line `data:`, this needs
 * adjusting.
 */

export interface ParsedSseFrame {
  id?: string;
  event: string;
  data: unknown;
}

export interface ConsumeSseStreamInput {
  response: Response;
  onFrame: (frame: ParsedSseFrame) => void;
  signal?: AbortSignal;
}

export async function consumeSseStream(input: ConsumeSseStreamInput): Promise<void> {
  if (!input.response.body) throw new Error("response_body_missing");
  const reader = input.response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let abortListener: (() => void) | null = null;
  if (input.signal) {
    if (input.signal.aborted) {
      await reader.cancel().catch(() => {});
      throw new DOMException("aborted", "AbortError");
    }
    abortListener = () => {
      void reader.cancel().catch(() => {});
    };
    input.signal.addEventListener("abort", abortListener, { once: true });
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (input.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      if (done) {
        const tail = buffer.trim();
        if (tail.length > 0) {
          const frame = parseFrame(tail);
          if (frame) input.onFrame(frame);
        }
        return;
      }
      buffer += value;
      let split;
      while ((split = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const frame = parseFrame(raw);
        if (frame) input.onFrame(frame);
      }
    }
  } finally {
    if (input.signal && abortListener) {
      input.signal.removeEventListener("abort", abortListener);
    }
    try {
      reader.releaseLock();
    } catch {
      // releaseLock throws if a read is in-flight; safe to ignore on abort
    }
  }
}

export function parseFrame(raw: string): ParsedSseFrame | null {
  const lines = raw.split("\n");
  let id: string | undefined;
  let event = "message";
  let dataRaw = "";
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataRaw = dataRaw.length === 0 ? value : `${dataRaw}\n${value}`;
  }
  if (!dataRaw) return null;
  let data: unknown;
  try {
    data = JSON.parse(dataRaw);
  } catch {
    data = dataRaw;
  }
  return { id, event, data };
}
