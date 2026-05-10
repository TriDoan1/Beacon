import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  SupportMessageRole,
  SupportMessageToolCall,
  SupportMessageToolResult,
  SupportMessageTransportMetadata,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { supportSessions } from "./support_sessions.js";

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => supportSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<SupportMessageRole>().notNull(),
    content: text("content").notNull().default(""),
    toolCalls: jsonb("tool_calls").$type<SupportMessageToolCall[] | null>(),
    toolResults: jsonb("tool_results").$type<SupportMessageToolResult[] | null>(),
    transportMetadata: jsonb("transport_metadata").$type<SupportMessageTransportMetadata | null>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionSeqIdx: uniqueIndex("support_messages_session_seq_idx").on(table.sessionId, table.seq),
    companySessionIdx: index("support_messages_company_session_idx").on(table.companyId, table.sessionId),
  }),
);
