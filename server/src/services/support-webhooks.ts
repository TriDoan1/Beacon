import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../middleware/logger.js";

export type SupportWebhookEventType =
  | "intake_submitted"
  | "session_closed";

export interface SupportWebhookEventBase {
  /** Stable identifier for the delivery — receivers can use it for idempotency. */
  id: string;
  /** Event type. Receivers should switch on this string. */
  type: SupportWebhookEventType;
  /** ISO-8601 timestamp at which the event was generated. */
  occurredAt: string;
  /** Product key the event belongs to. */
  productKey: string;
  /** Support session that produced the event. */
  sessionId: string;
}

export interface IntakeSubmittedEvent extends SupportWebhookEventBase {
  type: "intake_submitted";
  issueId: string;
  intakePacketId: string;
  endUser: {
    externalId: string;
    email: string | null;
    name: string | null;
  };
  intake: {
    whatUserWasDoing: string;
    whatHappened: string;
    reproSteps: string[];
    affectedFeature: string | null;
    severityHint: string | null;
  };
  context: {
    url: string | null;
    routePath: string | null;
    userAgent: string | null;
  };
}

export interface SessionClosedEvent extends SupportWebhookEventBase {
  type: "session_closed";
  closeReason: string | null;
  modelUsed: string;
  spendUsdCents: number;
  turnCount: number;
  endUser: {
    externalId: string;
    email: string | null;
    name: string | null;
  };
  /** Linked when the close was driven by intake_submitted. */
  issueId?: string;
}

export type SupportWebhookEvent = IntakeSubmittedEvent | SessionClosedEvent;

/**
 * Sign the JSON-encoded body with the product's webhook secret using
 * HMAC-SHA256. Receivers can verify with verifyWebhookSignature().
 *
 * Header format mirrors Stripe's: `t=<unix-seconds>,v1=<hex-digest>`. The
 * timestamp is part of the signed payload (`<timestamp>.<body>`) so a
 * captured request can't be replayed indefinitely.
 */
export function signWebhook(secret: string, body: string, now: Date = new Date()): string {
  const ts = Math.floor(now.getTime() / 1000);
  const hmac = createHmac("sha256", secret);
  hmac.update(`${ts}.${body}`);
  return `t=${ts},v1=${hmac.digest("hex")}`;
}

export interface VerifyWebhookSignatureInput {
  secret: string;
  body: string;
  signatureHeader: string;
  /** Reject if the timestamp is older than this (default 5 minutes). */
  toleranceSeconds?: number;
  now?: Date;
}

export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  const tolerance = input.toleranceSeconds ?? 5 * 60;
  const now = input.now ?? new Date();
  const parts = input.signatureHeader.split(",");
  let ts: number | null = null;
  let v1: string | null = null;
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t" && v) ts = Number(v);
    else if (k === "v1" && v) v1 = v;
  }
  if (ts === null || !v1) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - ts) > tolerance) return false;
  const expected = createHmac("sha256", input.secret).update(`${ts}.${input.body}`).digest("hex");
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
}

export interface DeliverWebhookInput {
  url: string;
  secret: string;
  event: SupportWebhookEvent;
  /** Override fetch (used in tests). */
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout. Default 5s. */
  timeoutMs?: number;
}

export interface DeliverWebhookResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  errorCode: string | null;
}

/**
 * Fire-and-log webhook delivery. No retry queue in v1 — receivers that
 * miss a delivery must reconcile against /replay or the assets API.
 *
 * Delivery is fire-and-forget at the call site (see route handler), but the
 * function itself returns a result so tests can assert behavior.
 */
export async function deliverSupportWebhook(input: DeliverWebhookInput): Promise<DeliverWebhookResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 5000;
  const body = JSON.stringify(input.event);
  const signature = signWebhook(input.secret, body);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetchImpl(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "PaperclipSupportWebhook/1",
        "x-paperclip-event": input.event.type,
        "x-paperclip-event-id": input.event.id,
        "x-paperclip-signature": signature,
      },
      body,
      signal: ctl.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - start,
      errorCode: res.ok ? null : `http_${res.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - start,
      errorCode: ctl.signal.aborted ? "timeout" : message.slice(0, 80),
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fire a webhook in the background — never blocks the SSE response. Logs
 * structured details on each attempt; the call site does not await it.
 */
export function fireWebhook(input: DeliverWebhookInput): void {
  void deliverSupportWebhook(input).then((result) => {
    if (result.ok) {
      logger.info(
        { eventType: input.event.type, eventId: input.event.id, status: result.status, durationMs: result.durationMs },
        "support: webhook delivered",
      );
    } else {
      logger.warn(
        {
          eventType: input.event.type,
          eventId: input.event.id,
          status: result.status,
          errorCode: result.errorCode,
          durationMs: result.durationMs,
        },
        "support: webhook delivery failed",
      );
    }
  });
}
