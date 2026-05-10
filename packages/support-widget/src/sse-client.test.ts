import { describe, expect, it } from "vitest";
import { consumeSseStream, parseFrame } from "./sse-client.js";

describe("parseFrame", () => {
  it("parses event + data + id", () => {
    const frame = parseFrame("id: 7\nevent: text\ndata: {\"delta\":\"hi\"}");
    expect(frame).toEqual({ id: "7", event: "text", data: { delta: "hi" } });
  });

  it("ignores comment lines and unknown fields", () => {
    const frame = parseFrame(": heartbeat\nfoo: bar\nevent: text\ndata: 1");
    expect(frame).toEqual({ event: "text", data: 1 });
  });

  it("returns null when there is no data field", () => {
    expect(parseFrame("event: x\nid: 1")).toBeNull();
  });

  it("falls back to raw string when data is not JSON", () => {
    expect(parseFrame("event: text\ndata: hello")).toEqual({ event: "text", data: "hello" });
  });
});

describe("consumeSseStream", () => {
  it("emits frames split by \\n\\n", async () => {
    const body = makeStream([
      "event: text\ndata: {\"delta\":\"a\"}\n\n",
      "event: text\ndata: {\"delta\":\"b\"}\n\n",
      "event: complete\ndata: {\"closeReason\":null}\n\n",
    ]);
    const frames: { event: string; data: unknown }[] = [];
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    await consumeSseStream({
      response,
      onFrame: (f) => frames.push({ event: f.event, data: f.data }),
    });
    expect(frames).toEqual([
      { event: "text", data: { delta: "a" } },
      { event: "text", data: { delta: "b" } },
      { event: "complete", data: { closeReason: null } },
    ]);
  });

  it("handles a frame split across chunks", async () => {
    const body = makeStream(["event: text\ndata: {\"delta\":\"hel", "lo\"}\n\n"]);
    const frames: { event: string; data: unknown }[] = [];
    const response = new Response(body, { status: 200 });
    await consumeSseStream({ response, onFrame: (f) => frames.push({ event: f.event, data: f.data }) });
    expect(frames).toEqual([{ event: "text", data: { delta: "hello" } }]);
  });

  it("emits a trailing frame even without a final \\n\\n", async () => {
    const body = makeStream(["event: complete\ndata: {\"closeReason\":\"intake_submitted\"}"]);
    const frames: { event: string; data: unknown }[] = [];
    await consumeSseStream({
      response: new Response(body, { status: 200 }),
      onFrame: (f) => frames.push({ event: f.event, data: f.data }),
    });
    expect(frames).toEqual([{ event: "complete", data: { closeReason: "intake_submitted" } }]);
  });

  it("aborts when the signal is fired", async () => {
    const ctl = new AbortController();
    const body = neverEndingStream();
    const response = new Response(body, { status: 200 });
    setTimeout(() => ctl.abort(), 10);
    await expect(
      consumeSseStream({ response, onFrame: () => {}, signal: ctl.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
}

function neverEndingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start() {
      // Keep the stream open until aborted by the consumer.
    },
  });
}
