import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type {
  SupportSessionInitialContext,
  SupportSessionStatus,
  SupportSessionTransport,
  SupportSessionCloseReason,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { supportEndUsers } from "./support_end_users.js";

export const supportSessions = pgTable(
  "support_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    endUserId: uuid("end_user_id").notNull().references(() => supportEndUsers.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    transport: text("transport").$type<SupportSessionTransport>().notNull().default("widget"),
    status: text("status").$type<SupportSessionStatus>().notNull().default("active"),
    closeReason: text("close_reason").$type<SupportSessionCloseReason | null>(),
    sdkSessionId: text("sdk_session_id"),
    modelUsed: text("model_used").notNull(),
    linkedIssueId: uuid("linked_issue_id").references(() => issues.id, { onDelete: "set null" }),
    takenOverByUserId: text("taken_over_by_user_id"),
    inputTokensUsed: integer("input_tokens_used").notNull().default(0),
    outputTokensUsed: integer("output_tokens_used").notNull().default(0),
    spendUsdCents: integer("spend_usd_cents").notNull().default(0),
    turnCount: integer("turn_count").notNull().default(0),
    initialContext: jsonb("initial_context").$type<SupportSessionInitialContext>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("support_sessions_company_status_idx").on(table.companyId, table.status),
    companyProductStatusIdx: index("support_sessions_company_product_status_idx").on(
      table.companyId,
      table.productKey,
      table.status,
    ),
    endUserOpenedAtIdx: index("support_sessions_end_user_opened_at_idx").on(table.endUserId, table.openedAt),
    linkedIssueIdx: index("support_sessions_linked_issue_idx").on(table.linkedIssueId),
  }),
);
