import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { SupportWidgetTheme } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const supportWidgetConfigs = pgTable(
  "support_widget_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    productLabel: text("product_label").notNull(),
    supabaseProjectUrl: text("supabase_project_url"),
    supabaseJwksUrl: text("supabase_jwks_url"),
    supabaseAudience: text("supabase_audience"),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    webhookUrl: text("webhook_url"),
    webhookSigningSecret: text("webhook_signing_secret"),
    theme: jsonb("theme").$type<SupportWidgetTheme>().notNull().default({}),
    perSessionTokenCapUsdCents: integer("per_session_token_cap_usd_cents").notNull().default(100),
    perUserDailyTokenCapUsdCents: integer("per_user_daily_token_cap_usd_cents").notNull().default(500),
    perIpHourlyRateLimit: integer("per_ip_hourly_rate_limit").notNull().default(10),
    perSessionMaxTurns: integer("per_session_max_turns").notNull().default(40),
    enabled: jsonb("enabled").$type<{ widget: boolean; email: boolean; sms: boolean }>().notNull().default({ widget: true, email: false, sms: false }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProductIdx: uniqueIndex("support_widget_configs_company_product_idx").on(table.companyId, table.productKey),
    companyAgentIdx: index("support_widget_configs_company_agent_idx").on(table.companyId, table.agentId),
  }),
);
