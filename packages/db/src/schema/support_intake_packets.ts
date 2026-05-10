import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type {
  SupportIntakeBrowserInfo,
  SupportIntakeConsoleError,
  SupportIntakeNetworkError,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { supportSessions } from "./support_sessions.js";
import { issues } from "./issues.js";
import { assets } from "./assets.js";

export const supportIntakePackets = pgTable(
  "support_intake_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => supportSessions.id, { onDelete: "cascade" }),
    whatUserWasDoing: text("what_user_was_doing").notNull(),
    whatHappened: text("what_happened").notNull(),
    reproSteps: jsonb("repro_steps").$type<string[]>().notNull().default([]),
    affectedFeature: text("affected_feature"),
    screenshotAssetId: uuid("screenshot_asset_id").references(() => assets.id, { onDelete: "set null" }),
    attachmentAssetIds: jsonb("attachment_asset_ids").$type<string[]>().notNull().default([]),
    browserInfo: jsonb("browser_info").$type<SupportIntakeBrowserInfo>().notNull().default({}),
    consoleErrors: jsonb("console_errors").$type<SupportIntakeConsoleError[]>().notNull().default([]),
    networkErrors: jsonb("network_errors").$type<SupportIntakeNetworkError[]>().notNull().default([]),
    linkedIssueId: uuid("linked_issue_id").references(() => issues.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySessionIdx: index("support_intake_packets_company_session_idx").on(table.companyId, table.sessionId),
    linkedIssueIdx: index("support_intake_packets_linked_issue_idx").on(table.linkedIssueId),
  }),
);
