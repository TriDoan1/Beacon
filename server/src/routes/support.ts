import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { assets, supportWidgetConfigs } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import { fireWebhook, type SupportWebhookEvent } from "../services/support-webhooks.js";
import {
  SUPPORT_DEFAULT_GREETING,
  SUPPORT_DEFAULT_MAX_TURNS_PER_SESSION,
  SUPPORT_INTAKE_TOOL_NAMES,
  type SupportSessionInitialContext,
  type SupportSessionOpenResponse,
  type SupportSessionReplayResponse,
  type SupportWidgetTheme,
} from "@paperclipai/shared";
import {
  buildSystemPrompt,
  runConciergeTurn,
  type ConciergeHistoryMessage,
} from "@paperclipai/adapter-concierge/server";
import {
  appendMessage,
  applyToolEffects,
  closeSession,
  createSupportSession,
  loadSession,
  loadSessionMessages,
  loadSupportProductContext,
  recordTurnUsage,
  todayUserDailySpendCents,
  upsertSupportEndUser,
  type SupportProductContext,
} from "../services/support.js";
import {
  deriveSupabaseJwksUrl,
  verifySupabaseEndUserToken,
} from "../services/support-end-user-auth.js";
import { checkRateLimit } from "../services/support-rate-limit.js";
import { logger } from "../middleware/logger.js";

const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";

function clientIp(req: Request): string {
  const forwarded = req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? "unknown";
}

function originAllowed(ctx: SupportProductContext, origin: string | undefined): boolean {
  if (!origin) return false;
  if (!ctx.allowedOrigins || ctx.allowedOrigins.length === 0) return false;
  return ctx.allowedOrigins.includes(origin);
}

async function authenticateEndUser(
  ctx: SupportProductContext,
  authHeader: string | undefined,
): Promise<{ externalId: string; email: string | null; name: string | null }> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "missing_token");
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new HttpError(401, "missing_token");
  const jwksUrl =
    ctx.supabaseJwksUrl ?? (ctx.supabaseProjectUrl ? deriveSupabaseJwksUrl(ctx.supabaseProjectUrl) : null);
  if (!jwksUrl) throw new HttpError(500, "supabase_jwks_not_configured");
  let claims;
  try {
    claims = await verifySupabaseEndUserToken({
      token,
      jwksUrl,
      expectedAudience: ctx.supabaseAudience ?? undefined,
    });
  } catch (err) {
    throw new HttpError(401, "invalid_token");
  }
  const email = claims.email ?? null;
  const name =
    claims.user_metadata && typeof claims.user_metadata.full_name === "string"
      ? (claims.user_metadata.full_name as string)
      : claims.user_metadata && typeof claims.user_metadata.name === "string"
      ? (claims.user_metadata.name as string)
      : null;
  return { externalId: claims.sub, email, name };
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

function sendError(res: Response, err: unknown) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code });
    return;
  }
  logger.error({ err }, "support: unexpected error");
  res.status(500).json({ error: "internal_error" });
}

async function loadTheme(db: Db, productKey: string): Promise<SupportWidgetTheme> {
  const rows = await db
    .select({ theme: supportWidgetConfigs.theme })
    .from(supportWidgetConfigs)
    .where(eq(supportWidgetConfigs.productKey, productKey))
    .limit(1);
  return (rows[0]?.theme ?? {}) as SupportWidgetTheme;
}

const SUPPORT_ASSET_MAX_BYTES = 10 * 1024 * 1024;
const SUPPORT_ASSET_ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
]);

export function supportRoutes(db: Db, storage?: StorageService): Router {
  const router = Router();
  const assetUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: SUPPORT_ASSET_MAX_BYTES, files: 1 },
  });

  function runFileUpload(req: Request, res: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      assetUpload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // GET /api/support/products/:productKey/theme
  router.get("/api/support/products/:productKey/theme", async (req, res) => {
    try {
      const ctx = await loadSupportProductContext(db, req.params.productKey ?? "");
      if (!ctx) {
        res.status(404).json({ error: "product_not_found" });
        return;
      }
      const origin = req.header("origin");
      if (origin && !originAllowed(ctx, origin)) {
        res.status(403).json({ error: "origin_not_allowed" });
        return;
      }
      if (origin) res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Headers", "authorization,content-type,last-event-id");
      const theme = await loadTheme(db, ctx.productKey);
      res.json({
        productKey: ctx.productKey,
        productLabel: ctx.productLabel,
        theme,
        enabled: ctx.enabled,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // OPTIONS preflight (covers all support routes)
  router.options("/api/support/*splat", async (req, res) => {
    const origin = req.header("origin");
    res.header("Access-Control-Allow-Origin", origin ?? "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "authorization,content-type,last-event-id");
    res.header("Access-Control-Max-Age", "600");
    res.status(204).end();
  });

  // POST /api/support/sessions
  router.post("/api/support/sessions", async (req, res) => {
    try {
      const productKey = String((req.body as { productKey?: string })?.productKey ?? "").trim();
      if (!productKey) throw new HttpError(400, "missing_product_key");
      const ctx = await loadSupportProductContext(db, productKey);
      if (!ctx) throw new HttpError(404, "product_not_found");
      if (!ctx.enabled.widget) throw new HttpError(403, "widget_disabled");
      const origin = req.header("origin");
      if (origin && !originAllowed(ctx, origin)) {
        throw new HttpError(403, "origin_not_allowed");
      }
      const ipKey = `ip:${clientIp(req)}`;
      const ipRl = checkRateLimit(
        ipKey,
        ctx.perIpHourlyRateLimit,
        60 * 60 * 1000,
      );
      if (!ipRl.allowed) throw new HttpError(429, "rate_limited");

      const auth = await authenticateEndUser(ctx, req.header("authorization"));
      const endUser = await upsertSupportEndUser(db, {
        companyId: ctx.companyId,
        productKey: ctx.productKey,
        externalId: auth.externalId,
        email: auth.email,
        name: auth.name,
      });

      const dailySpend = await todayUserDailySpendCents(db, endUser.id);
      if (dailySpend >= ctx.perUserDailyTokenCapUsdCents) {
        throw new HttpError(429, "user_daily_cap_exceeded");
      }

      const initialContext = ((req.body as { initialContext?: SupportSessionInitialContext })?.initialContext ??
        {}) as SupportSessionInitialContext;
      const session = await createSupportSession(db, {
        ctx,
        endUserId: endUser.id,
        transport: "widget",
        initialContext,
      });

      if (origin) res.header("Access-Control-Allow-Origin", origin);
      const payload: SupportSessionOpenResponse = {
        sessionId: session.id,
        modelUsed: session.modelUsed,
        greeting: ctx.greeting ?? SUPPORT_DEFAULT_GREETING,
        theme: await loadTheme(db, ctx.productKey),
        status: "active",
      };
      res.status(201).json(payload);
    } catch (err) {
      sendError(res, err);
    }
  });

  // POST /api/support/sessions/:sessionId/turns  (SSE stream)
  router.post("/api/support/sessions/:sessionId/turns", async (req, res) => {
    const sessionId = req.params.sessionId ?? "";
    try {
      const session = await loadSession(db, sessionId);
      if (!session) throw new HttpError(404, "session_not_found");
      if (session.status !== "active") throw new HttpError(409, "session_closed");
      const ctx = await loadSupportProductContext(db, session.productKey);
      if (!ctx) throw new HttpError(404, "product_not_found");
      const origin = req.header("origin");
      if (origin && !originAllowed(ctx, origin)) throw new HttpError(403, "origin_not_allowed");

      const auth = await authenticateEndUser(ctx, req.header("authorization"));
      const endUser = await upsertSupportEndUser(db, {
        companyId: ctx.companyId,
        productKey: ctx.productKey,
        externalId: auth.externalId,
        email: auth.email,
        name: auth.name,
      });
      if (endUser.id !== session.endUserId) throw new HttpError(403, "session_user_mismatch");

      if (session.spendUsdCents >= ctx.perSessionTokenCapUsdCents) {
        await closeSession(db, { sessionId, reason: "cost_cap" });
        throw new HttpError(402, "session_cost_cap_exceeded");
      }
      if (session.turnCount >= (ctx.maxTurns || SUPPORT_DEFAULT_MAX_TURNS_PER_SESSION)) {
        await closeSession(db, { sessionId, reason: "abandoned" });
        throw new HttpError(429, "session_turn_limit_exceeded");
      }

      const userMessage = String((req.body as { message?: string })?.message ?? "").trim();
      if (!userMessage) throw new HttpError(400, "empty_message");

      const apiKey = process.env[ANTHROPIC_API_KEY_ENV];
      if (!apiKey) throw new HttpError(500, "anthropic_api_key_missing");

      // Persist the user turn before streaming
      await appendMessage(db, {
        companyId: ctx.companyId,
        sessionId,
        role: "user",
        content: userMessage,
      });

      const history = await loadSessionMessages(db, sessionId);
      const conciergeHistory: ConciergeHistoryMessage[] = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(0, -1) // exclude the just-inserted user message — passed separately
        .map((m) => ({
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
        }));

      // SSE headers
      if (origin) res.header("Access-Control-Allow-Origin", origin);
      res.header("Content-Type", "text/event-stream");
      res.header("Cache-Control", "no-cache, no-transform");
      res.header("Connection", "keep-alive");
      res.flushHeaders?.();

      const writeEvent = (eventName: string, data: unknown, seq?: number) => {
        if (seq !== undefined) res.write(`id: ${seq}\n`);
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const systemPrompt = buildSystemPrompt({
        productLabel: ctx.productLabel,
        customPrompt: ctx.systemPromptOverride,
        productKey: ctx.productKey,
      });

      const generator = runConciergeTurn({
        apiKey,
        model: session.modelUsed,
        systemPrompt,
        history: conciergeHistory,
        userMessage,
      });

      let assistantText = "";
      const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
      const toolEffectsCollected: import("@paperclipai/adapter-concierge/server").ConciergeToolEffect[] = [];
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        let result;
        while (true) {
          const next = await generator.next();
          if (next.done) {
            result = next.value;
            break;
          }
          const ev = next.value;
          if (ev.type === "text_delta" && ev.textDelta) {
            assistantText += ev.textDelta;
            writeEvent("text", { delta: ev.textDelta });
          } else if (ev.type === "tool_call" && ev.toolCall) {
            toolCalls.push(ev.toolCall);
            writeEvent("tool_call", {
              id: ev.toolCall.id,
              name: ev.toolCall.name,
              arguments: ev.toolCall.arguments,
            });
            // tool effect is parsed by the adapter and surfaced via the
            // returned result; we emit the corresponding event immediately
            const isTerminal =
              ev.toolCall.name === SUPPORT_INTAKE_TOOL_NAMES.submitIntake ||
              ev.toolCall.name === SUPPORT_INTAKE_TOOL_NAMES.requestHuman ||
              ev.toolCall.name === SUPPORT_INTAKE_TOOL_NAMES.notABug;
            if (isTerminal) {
              writeEvent("session_will_close", { tool: ev.toolCall.name });
            }
          } else if (ev.type === "usage") {
            inputTokens = ev.inputTokens ?? inputTokens;
            outputTokens = ev.outputTokens ?? outputTokens;
          } else if (ev.type === "error" && ev.errorMessage) {
            writeEvent("error", { message: ev.errorMessage });
          }
        }
        toolEffectsCollected.push(...result.toolEffects);
      } catch (err) {
        writeEvent("error", { message: err instanceof Error ? err.message : String(err) });
        res.end();
        return;
      }

      // Persist assistant turn + record usage
      const assistantSeq = await appendMessage(db, {
        companyId: ctx.companyId,
        sessionId,
        role: "assistant",
        content: assistantText,
        toolCalls: toolCalls.length > 0 ? toolCalls : null,
        inputTokens,
        outputTokens,
      });
      await recordTurnUsage(db, {
        sessionId,
        inputTokens,
        outputTokens,
        modelUsed: session.modelUsed,
      });

      const effectsResult = await applyToolEffects(db, {
        sessionId,
        companyId: ctx.companyId,
        productKey: ctx.productKey,
        productLabel: ctx.productLabel,
        endUserEmail: auth.email ?? null,
        effects: toolEffectsCollected,
        initialContext: session.initialContext,
      });

      // Fire webhooks AFTER persistence so receivers see consistent state
      // even if delivery fails. Delivery is fire-and-forget; failures are
      // logged but never block the SSE response.
      if (ctx.webhookUrl && ctx.webhookSigningSecret) {
        const occurredAt = new Date().toISOString();
        if (effectsResult.intake && effectsResult.intakeIssueId && effectsResult.intakePacketId) {
          const event: SupportWebhookEvent = {
            id: randomUUID(),
            type: "intake_submitted",
            occurredAt,
            productKey: ctx.productKey,
            sessionId,
            issueId: effectsResult.intakeIssueId,
            intakePacketId: effectsResult.intakePacketId,
            endUser: {
              externalId: auth.externalId,
              email: auth.email ?? null,
              name: auth.name ?? null,
            },
            intake: {
              whatUserWasDoing: effectsResult.intake.whatUserWasDoing,
              whatHappened: effectsResult.intake.whatHappened,
              reproSteps: effectsResult.intake.reproSteps,
              affectedFeature: effectsResult.intake.affectedFeature ?? null,
              severityHint: effectsResult.intake.severityHint ?? null,
            },
            context: {
              url: session.initialContext.url ?? null,
              routePath: session.initialContext.routePath ?? null,
              userAgent: session.initialContext.userAgent ?? null,
            },
          };
          fireWebhook({ url: ctx.webhookUrl, secret: ctx.webhookSigningSecret, event });
        }
        if (effectsResult.closeReason) {
          // Re-read totals so the webhook sees post-update spend/turn count.
          const refreshed = await loadSession(db, sessionId);
          const event: SupportWebhookEvent = {
            id: randomUUID(),
            type: "session_closed",
            occurredAt,
            productKey: ctx.productKey,
            sessionId,
            closeReason: effectsResult.closeReason,
            modelUsed: session.modelUsed,
            spendUsdCents: refreshed?.spendUsdCents ?? session.spendUsdCents,
            turnCount: refreshed?.turnCount ?? session.turnCount,
            endUser: {
              externalId: auth.externalId,
              email: auth.email ?? null,
              name: auth.name ?? null,
            },
            ...(effectsResult.intakeIssueId ? { issueId: effectsResult.intakeIssueId } : {}),
          };
          fireWebhook({ url: ctx.webhookUrl, secret: ctx.webhookSigningSecret, event });
        }
      }

      writeEvent(
        "complete",
        {
          assistantMessageSeq: assistantSeq.seq,
          status: effectsResult.closeReason ? "closed" : "active",
          closeReason: effectsResult.closeReason,
          issueId: effectsResult.intakeIssueId ?? null,
        },
        assistantSeq.seq,
      );
      res.end();
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /api/support/sessions/:sessionId/replay?afterSeq=N
  router.get("/api/support/sessions/:sessionId/replay", async (req, res) => {
    const sessionId = req.params.sessionId ?? "";
    try {
      const session = await loadSession(db, sessionId);
      if (!session) throw new HttpError(404, "session_not_found");
      const ctx = await loadSupportProductContext(db, session.productKey);
      if (!ctx) throw new HttpError(404, "product_not_found");
      const origin = req.header("origin");
      if (origin && !originAllowed(ctx, origin)) throw new HttpError(403, "origin_not_allowed");
      const auth = await authenticateEndUser(ctx, req.header("authorization"));
      const endUser = await upsertSupportEndUser(db, {
        companyId: ctx.companyId,
        productKey: ctx.productKey,
        externalId: auth.externalId,
        email: auth.email,
        name: auth.name,
      });
      if (endUser.id !== session.endUserId) throw new HttpError(403, "session_user_mismatch");

      const afterSeqParam = req.query.afterSeq;
      const afterSeq =
        typeof afterSeqParam === "string" && /^\d+$/.test(afterSeqParam) ? Number(afterSeqParam) : undefined;
      const messages = await loadSessionMessages(db, sessionId, afterSeq);
      if (origin) res.header("Access-Control-Allow-Origin", origin);
      const payload: SupportSessionReplayResponse = {
        sessionId,
        status: session.status as SupportSessionReplayResponse["status"],
        closeReason: session.closeReason as SupportSessionReplayResponse["closeReason"],
        modelUsed: session.modelUsed,
        messages: messages.map((m) => ({
          id: m.id,
          seq: m.seq,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls,
          createdAt: m.createdAt.toISOString(),
        })),
      };
      res.json(payload);
    } catch (err) {
      sendError(res, err);
    }
  });

  // POST /api/support/sessions/:sessionId/assets — multipart upload
  // Used by the widget to attach screenshots and arbitrary attachments to an
  // active support session. The asset id returned here is referenced by the
  // model when it calls submit_intake_packet.
  router.post("/api/support/sessions/:sessionId/assets", async (req, res) => {
    const sessionId = req.params.sessionId ?? "";
    try {
      if (!storage) throw new HttpError(503, "storage_not_configured");
      const session = await loadSession(db, sessionId);
      if (!session) throw new HttpError(404, "session_not_found");
      if (session.status !== "active") throw new HttpError(409, "session_closed");
      const ctx = await loadSupportProductContext(db, session.productKey);
      if (!ctx) throw new HttpError(404, "product_not_found");
      const origin = req.header("origin");
      if (origin && !originAllowed(ctx, origin)) throw new HttpError(403, "origin_not_allowed");

      const auth = await authenticateEndUser(ctx, req.header("authorization"));
      const endUser = await upsertSupportEndUser(db, {
        companyId: ctx.companyId,
        productKey: ctx.productKey,
        externalId: auth.externalId,
        email: auth.email,
        name: auth.name,
      });
      if (endUser.id !== session.endUserId) throw new HttpError(403, "session_user_mismatch");

      try {
        await runFileUpload(req, res);
      } catch (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            throw new HttpError(422, "file_too_large");
          }
          throw new HttpError(400, err.code);
        }
        throw err;
      }

      const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
      if (!file) throw new HttpError(400, "missing_file");
      const contentType = (file.mimetype || "").toLowerCase();
      if (!SUPPORT_ASSET_ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new HttpError(422, "unsupported_content_type");
      }
      if (file.buffer.length === 0) throw new HttpError(422, "empty_file");

      const stored = await storage.putFile({
        companyId: ctx.companyId,
        namespace: `support/sessions/${sessionId}`,
        originalFilename: file.originalname || null,
        contentType,
        body: file.buffer,
      });
      const inserted = await db
        .insert(assets)
        .values({
          companyId: ctx.companyId,
          provider: stored.provider,
          objectKey: stored.objectKey,
          contentType: stored.contentType,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          originalFilename: stored.originalFilename,
        })
        .returning({ id: assets.id });

      if (origin) res.header("Access-Control-Allow-Origin", origin);
      res.status(201).json({
        assetId: inserted[0]!.id,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        contentPath: `/api/assets/${inserted[0]!.id}/content`,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // 501 stubs for inbound transports — schema is ready, handlers later
  router.post("/api/support/inbound/email", (_req, res) => {
    res.status(501).json({ error: "not_implemented", note: "Resend inbound webhook handler arrives in Phase 1." });
  });
  router.post("/api/support/inbound/sms", (_req, res) => {
    res.status(501).json({ error: "not_implemented", note: "Twilio inbound webhook handler arrives in Phase 1." });
  });

  return router;
}
