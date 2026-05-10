import { and, eq, max as sqlMax, sql, gte, count } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  issues,
  supportEndUsers,
  supportIntakePackets,
  supportMessages,
  supportSessions,
  supportWidgetConfigs,
} from "@paperclipai/db";
import {
  SUPPORT_DEFAULT_MAX_TURNS_PER_SESSION,
  SUPPORT_DEFAULT_MODEL,
  estimateSupportSessionCostUsdCents,
  type SupportConciergeAdapterConfig,
  type SupportSessionCloseReason,
  type SupportSessionInitialContext,
  type SupportSessionTransport,
  type SupportMessageRole,
  type SupportMessageToolCall,
} from "@paperclipai/shared";
import type { ConciergeToolEffect } from "@paperclipai/adapter-concierge/server";

export interface SupportProductContext {
  companyId: string;
  productKey: string;
  productLabel: string;
  agentId: string;
  modelOverride?: string;
  systemPromptOverride?: string;
  greeting?: string;
  maxTurns: number;
  perSessionTokenCapUsdCents: number;
  perUserDailyTokenCapUsdCents: number;
  perIpHourlyRateLimit: number;
  allowedOrigins: string[];
  supabaseProjectUrl: string | null;
  supabaseJwksUrl: string | null;
  supabaseAudience: string | null;
  webhookUrl: string | null;
  webhookSigningSecret: string | null;
  enabled: { widget: boolean; email: boolean; sms: boolean };
}

export async function loadSupportProductContext(
  db: Db,
  productKey: string,
): Promise<SupportProductContext | null> {
  const rows = await db
    .select({
      cfg: supportWidgetConfigs,
      agent: agents,
    })
    .from(supportWidgetConfigs)
    .innerJoin(agents, eq(agents.id, supportWidgetConfigs.agentId))
    .where(eq(supportWidgetConfigs.productKey, productKey))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const adapterConfig = (row.agent.adapterConfig ?? {}) as Partial<SupportConciergeAdapterConfig>;
  return {
    companyId: row.cfg.companyId,
    productKey: row.cfg.productKey,
    productLabel: row.cfg.productLabel,
    agentId: row.agent.id,
    modelOverride: typeof adapterConfig.model === "string" ? adapterConfig.model : undefined,
    systemPromptOverride:
      typeof adapterConfig.systemPrompt === "string" ? adapterConfig.systemPrompt : undefined,
    greeting: typeof adapterConfig.greeting === "string" ? adapterConfig.greeting : undefined,
    maxTurns:
      typeof adapterConfig.maxTurnsPerSession === "number"
        ? adapterConfig.maxTurnsPerSession
        : SUPPORT_DEFAULT_MAX_TURNS_PER_SESSION,
    perSessionTokenCapUsdCents: row.cfg.perSessionTokenCapUsdCents,
    perUserDailyTokenCapUsdCents: row.cfg.perUserDailyTokenCapUsdCents,
    perIpHourlyRateLimit: row.cfg.perIpHourlyRateLimit,
    allowedOrigins: row.cfg.allowedOrigins ?? [],
    supabaseProjectUrl: row.cfg.supabaseProjectUrl,
    supabaseJwksUrl: row.cfg.supabaseJwksUrl,
    supabaseAudience: row.cfg.supabaseAudience,
    webhookUrl: row.cfg.webhookUrl,
    webhookSigningSecret: row.cfg.webhookSigningSecret,
    enabled: row.cfg.enabled ?? { widget: true, email: false, sms: false },
  };
}

export async function upsertSupportEndUser(
  db: Db,
  input: {
    companyId: string;
    productKey: string;
    externalId: string;
    email?: string | null;
    name?: string | null;
  },
): Promise<{ id: string }> {
  const existing = await db
    .select({ id: supportEndUsers.id })
    .from(supportEndUsers)
    .where(
      and(
        eq(supportEndUsers.companyId, input.companyId),
        eq(supportEndUsers.productKey, input.productKey),
        eq(supportEndUsers.externalId, input.externalId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(supportEndUsers)
      .set({
        email: input.email ?? null,
        name: input.name ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supportEndUsers.id, existing[0].id));
    return { id: existing[0].id };
  }
  const inserted = await db
    .insert(supportEndUsers)
    .values({
      companyId: input.companyId,
      productKey: input.productKey,
      externalId: input.externalId,
      email: input.email ?? null,
      name: input.name ?? null,
    })
    .returning({ id: supportEndUsers.id });
  return { id: inserted[0]!.id };
}

export async function createSupportSession(
  db: Db,
  input: {
    ctx: SupportProductContext;
    endUserId: string;
    transport: SupportSessionTransport;
    initialContext: SupportSessionInitialContext;
  },
): Promise<{ id: string; modelUsed: string }> {
  const modelUsed = input.ctx.modelOverride ?? SUPPORT_DEFAULT_MODEL;
  const inserted = await db
    .insert(supportSessions)
    .values({
      companyId: input.ctx.companyId,
      agentId: input.ctx.agentId,
      endUserId: input.endUserId,
      productKey: input.ctx.productKey,
      transport: input.transport,
      modelUsed,
      initialContext: input.initialContext,
    })
    .returning({ id: supportSessions.id });
  return { id: inserted[0]!.id, modelUsed };
}

export interface SupportSessionRecord {
  id: string;
  companyId: string;
  agentId: string;
  endUserId: string;
  productKey: string;
  transport: SupportSessionTransport;
  status: string;
  closeReason: string | null;
  modelUsed: string;
  inputTokensUsed: number;
  outputTokensUsed: number;
  spendUsdCents: number;
  turnCount: number;
  initialContext: SupportSessionInitialContext;
}

export async function loadSession(
  db: Db,
  sessionId: string,
): Promise<SupportSessionRecord | null> {
  const rows = await db
    .select()
    .from(supportSessions)
    .where(eq(supportSessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    endUserId: row.endUserId,
    productKey: row.productKey,
    transport: row.transport,
    status: row.status,
    closeReason: row.closeReason,
    modelUsed: row.modelUsed,
    inputTokensUsed: row.inputTokensUsed,
    outputTokensUsed: row.outputTokensUsed,
    spendUsdCents: row.spendUsdCents,
    turnCount: row.turnCount,
    initialContext: row.initialContext,
  };
}

export interface SupportMessageRecord {
  id: string;
  seq: number;
  role: SupportMessageRole;
  content: string;
  toolCalls: SupportMessageToolCall[] | null;
  createdAt: Date;
}

export async function loadSessionMessages(
  db: Db,
  sessionId: string,
  afterSeq?: number,
): Promise<SupportMessageRecord[]> {
  const rows = await db
    .select({
      id: supportMessages.id,
      seq: supportMessages.seq,
      role: supportMessages.role,
      content: supportMessages.content,
      toolCalls: supportMessages.toolCalls,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .where(
      afterSeq !== undefined
        ? and(eq(supportMessages.sessionId, sessionId), gte(supportMessages.seq, afterSeq + 1))
        : eq(supportMessages.sessionId, sessionId),
    )
    .orderBy(supportMessages.seq);
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    role: r.role as SupportMessageRole,
    content: r.content,
    toolCalls: r.toolCalls ?? null,
    createdAt: r.createdAt,
  }));
}

export async function nextSeq(db: Db, sessionId: string): Promise<number> {
  const rows = await db
    .select({ s: sqlMax(supportMessages.seq) })
    .from(supportMessages)
    .where(eq(supportMessages.sessionId, sessionId));
  const current = rows[0]?.s ?? null;
  return (current ?? 0) + 1;
}

export async function appendMessage(
  db: Db,
  input: {
    companyId: string;
    sessionId: string;
    role: SupportMessageRole;
    content: string;
    toolCalls?: SupportMessageToolCall[] | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  },
): Promise<{ id: string; seq: number }> {
  const seq = await nextSeq(db, input.sessionId);
  const inserted = await db
    .insert(supportMessages)
    .values({
      companyId: input.companyId,
      sessionId: input.sessionId,
      seq,
      role: input.role,
      content: input.content,
      toolCalls: input.toolCalls ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
    })
    .returning({ id: supportMessages.id });
  return { id: inserted[0]!.id, seq };
}

export async function recordTurnUsage(
  db: Db,
  input: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    modelUsed: string;
  },
): Promise<{ totalSpendUsdCents: number; totalTurnCount: number }> {
  const turnCostUsdCents = estimateSupportSessionCostUsdCents(
    input.modelUsed,
    input.inputTokens,
    input.outputTokens,
  );
  const updated = await db
    .update(supportSessions)
    .set({
      inputTokensUsed: sql`${supportSessions.inputTokensUsed} + ${input.inputTokens}`,
      outputTokensUsed: sql`${supportSessions.outputTokensUsed} + ${input.outputTokens}`,
      spendUsdCents: sql`${supportSessions.spendUsdCents} + ${turnCostUsdCents}`,
      turnCount: sql`${supportSessions.turnCount} + 1`,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportSessions.id, input.sessionId))
    .returning({
      spend: supportSessions.spendUsdCents,
      turns: supportSessions.turnCount,
    });
  const r = updated[0]!;
  return { totalSpendUsdCents: r.spend, totalTurnCount: r.turns };
}

export async function closeSession(
  db: Db,
  input: { sessionId: string; reason: SupportSessionCloseReason },
): Promise<void> {
  await db
    .update(supportSessions)
    .set({
      status: input.reason === "human_requested" ? "escalated" : "closed",
      closeReason: input.reason,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportSessions.id, input.sessionId));
}

export interface ApplyToolEffectsResult {
  closeReason: SupportSessionCloseReason | null;
  /** Set when an intake packet was submitted; identifies the new issue + packet for webhook callers. */
  intakeIssueId?: string;
  intakePacketId?: string;
  intake?: ConciergeToolEffect & { kind: "submit_intake" };
  humanRequest?: ConciergeToolEffect & { kind: "request_human" };
  notABug?: ConciergeToolEffect & { kind: "not_a_bug" };
}

export async function applyToolEffects(
  db: Db,
  input: {
    sessionId: string;
    companyId: string;
    productKey: string;
    productLabel: string;
    endUserEmail: string | null;
    effects: ConciergeToolEffect[];
    initialContext: SupportSessionInitialContext;
  },
): Promise<ApplyToolEffectsResult> {
  let closeReason: SupportSessionCloseReason | null = null;
  let intakeIssueId: string | undefined;
  let intakePacketId: string | undefined;
  const result: ApplyToolEffectsResult = { closeReason: null };

  for (const effect of input.effects) {
    if (effect.kind === "submit_intake") {
      const issueTitle = buildIssueTitle(input.productLabel, effect);
      const issueDescription = buildIssueDescription(effect, input);
      const insertedIssue = await db
        .insert(issues)
        .values({
          companyId: input.companyId,
          title: issueTitle,
          description: issueDescription,
          status: "backlog",
          priority: mapSeverityToPriority(effect.severityHint),
          originKind: "support_intake",
          originId: input.sessionId,
        })
        .returning({ id: issues.id });
      intakeIssueId = insertedIssue[0]!.id;

      const insertedPacket = await db
        .insert(supportIntakePackets)
        .values({
          companyId: input.companyId,
          sessionId: input.sessionId,
          whatUserWasDoing: effect.whatUserWasDoing,
          whatHappened: effect.whatHappened,
          reproSteps: effect.reproSteps,
          affectedFeature: effect.affectedFeature ?? null,
          browserInfo: {
            userAgent: input.initialContext.userAgent,
            viewport: input.initialContext.viewport,
            url: input.initialContext.url,
            routePath: input.initialContext.routePath,
            timeZone: input.initialContext.timeZone,
            language: input.initialContext.locale,
          },
          consoleErrors: input.initialContext.consoleErrors ?? [],
          networkErrors: input.initialContext.networkErrors ?? [],
          linkedIssueId: intakeIssueId,
          metadata: effect.severityHint ? { severityHint: effect.severityHint } : {},
        })
        .returning({ id: supportIntakePackets.id });
      intakePacketId = insertedPacket[0]!.id;

      await db
        .update(supportSessions)
        .set({ linkedIssueId: intakeIssueId, updatedAt: new Date() })
        .where(eq(supportSessions.id, input.sessionId));

      closeReason = "intake_submitted";
      result.intake = effect;
    } else if (effect.kind === "request_human") {
      closeReason = "human_requested";
      result.humanRequest = effect;
    } else if (effect.kind === "not_a_bug") {
      closeReason = "not_a_bug";
      result.notABug = effect;
    }
  }
  if (closeReason) {
    await closeSession(db, { sessionId: input.sessionId, reason: closeReason });
  }

  result.closeReason = closeReason;
  result.intakeIssueId = intakeIssueId;
  result.intakePacketId = intakePacketId;
  return result;
}

function buildIssueTitle(
  productLabel: string,
  effect: ConciergeToolEffect & { kind: "submit_intake" },
): string {
  const trimmedHappened = effect.whatHappened.trim().replace(/\s+/g, " ");
  const summary = trimmedHappened.length > 80 ? trimmedHappened.slice(0, 77).trimEnd() + "…" : trimmedHappened;
  return `[${productLabel}] ${summary || "User-reported issue"}`;
}

function buildIssueDescription(
  effect: ConciergeToolEffect & { kind: "submit_intake" },
  ctx: { sessionId: string; endUserEmail: string | null; productKey: string; initialContext: SupportSessionInitialContext },
): string {
  const lines: string[] = [];
  lines.push("**Reported via Support Concierge intake.**");
  lines.push("");
  lines.push(`- Product: \`${ctx.productKey}\``);
  if (ctx.endUserEmail) lines.push(`- Reporter: ${ctx.endUserEmail}`);
  if (ctx.initialContext.url) lines.push(`- URL: ${ctx.initialContext.url}`);
  if (ctx.initialContext.userAgent) lines.push(`- User agent: ${ctx.initialContext.userAgent}`);
  if (effect.affectedFeature) lines.push(`- Affected feature: ${effect.affectedFeature}`);
  if (effect.severityHint) lines.push(`- Severity hint (concierge): ${effect.severityHint}`);
  lines.push(`- Session: \`${ctx.sessionId}\``);
  lines.push("");
  lines.push("### What the user was doing");
  lines.push(effect.whatUserWasDoing.trim());
  lines.push("");
  lines.push("### What happened instead");
  lines.push(effect.whatHappened.trim());
  if (effect.reproSteps.length > 0) {
    lines.push("");
    lines.push("### Steps to reproduce");
    effect.reproSteps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
  }
  return lines.join("\n");
}

function mapSeverityToPriority(severity: string | undefined): string {
  switch (severity) {
    case "blocker":
      return "urgent";
    case "major":
      return "high";
    case "minor":
      return "medium";
    case "cosmetic":
      return "low";
    default:
      return "medium";
  }
}

export async function todayUserDailySpendCents(
  db: Db,
  endUserId: string,
): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ s: sql<number>`coalesce(sum(${supportSessions.spendUsdCents}), 0)::int` })
    .from(supportSessions)
    .where(and(eq(supportSessions.endUserId, endUserId), gte(supportSessions.openedAt, since)));
  return rows[0]?.s ?? 0;
}

export async function activeSessionCountForUser(
  db: Db,
  endUserId: string,
): Promise<number> {
  const rows = await db
    .select({ c: count() })
    .from(supportSessions)
    .where(and(eq(supportSessions.endUserId, endUserId), eq(supportSessions.status, "active")));
  return Number(rows[0]?.c ?? 0);
}
