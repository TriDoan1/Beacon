import { describe, expect, it } from "vitest";
import {
  deliverSupportWebhook,
  signWebhook,
  verifyWebhookSignature,
  type SupportWebhookEvent,
} from "./support-webhooks.js";

const SECRET = "whsec_super_secret_value";

const sampleEvent: SupportWebhookEvent = {
  id: "evt_1",
  type: "intake_submitted",
  occurredAt: "2026-05-09T20:00:00.000Z",
  productKey: "tailwind",
  sessionId: "sess_1",
  issueId: "iss_1",
  intakePacketId: "pkt_1",
  endUser: { externalId: "u_1", email: "user@example.com", name: null },
  intake: {
    whatUserWasDoing: "booking a trailer",
    whatHappened: "checkout failed",
    reproSteps: ["step 1", "step 2"],
    affectedFeature: "rentals",
    severityHint: "blocker",
  },
  context: { url: "https://tailwind.com/rentals", routePath: "/rentals", userAgent: "test" },
};

describe("signWebhook + verifyWebhookSignature", () => {
  it("round-trips a valid signature", () => {
    const body = JSON.stringify(sampleEvent);
    const now = new Date("2026-05-09T20:00:00Z");
    const sig = signWebhook(SECRET, body, now);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature({ secret: SECRET, body, signatureHeader: sig, now }),
    ).toBe(true);
  });

  it("rejects when the body is tampered with", () => {
    const body = JSON.stringify(sampleEvent);
    const now = new Date("2026-05-09T20:00:00Z");
    const sig = signWebhook(SECRET, body, now);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: body + "x",
        signatureHeader: sig,
        now,
      }),
    ).toBe(false);
  });

  it("rejects when the secret is wrong", () => {
    const body = JSON.stringify(sampleEvent);
    const now = new Date("2026-05-09T20:00:00Z");
    const sig = signWebhook(SECRET, body, now);
    expect(
      verifyWebhookSignature({
        secret: "wrong",
        body,
        signatureHeader: sig,
        now,
      }),
    ).toBe(false);
  });

  it("rejects when the timestamp is older than the tolerance", () => {
    const body = JSON.stringify(sampleEvent);
    const signedAt = new Date("2026-05-09T20:00:00Z");
    const sig = signWebhook(SECRET, body, signedAt);
    const verifyAt = new Date("2026-05-09T20:10:00Z"); // 10 minutes later
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body,
        signatureHeader: sig,
        toleranceSeconds: 60,
        now: verifyAt,
      }),
    ).toBe(false);
  });

  it("rejects malformed signature headers", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: "x",
        signatureHeader: "not-a-real-header",
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: "x",
        signatureHeader: "t=123",
      }),
    ).toBe(false);
  });
});

describe("deliverSupportWebhook", () => {
  it("posts the JSON body, signs it, and reports success", async () => {
    const seenRequests: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
      seenRequests.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const result = await deliverSupportWebhook({
      url: "https://example.test/webhook",
      secret: SECRET,
      event: sampleEvent,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    expect(seenRequests).toHaveLength(1);
    const req = seenRequests[0]!;
    expect(req.url).toBe("https://example.test/webhook");
    const headers = req.init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-paperclip-event"]).toBe("intake_submitted");
    expect(headers["x-paperclip-event-id"]).toBe("evt_1");
    expect(headers["x-paperclip-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // Verify the signature against what we sent
    const body = req.init?.body as string;
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body,
        signatureHeader: headers["x-paperclip-signature"]!,
      }),
    ).toBe(true);
  });

  it("reports a non-ok status without throwing", async () => {
    const fetchImpl = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const result = await deliverSupportWebhook({
      url: "https://example.test/webhook",
      secret: SECRET,
      event: sampleEvent,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.errorCode).toBe("http_500");
  });

  it("captures network errors as errorCode", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const result = await deliverSupportWebhook({
      url: "https://example.test/webhook",
      secret: SECRET,
      event: sampleEvent,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
    expect(result.errorCode).toContain("Failed to fetch");
  });
});
