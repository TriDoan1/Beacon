import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const supportEndUsers = pgTable(
  "support_end_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    externalId: text("external_id").notNull(),
    email: text("email"),
    name: text("name"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProductExternalIdx: uniqueIndex("support_end_users_company_product_external_idx").on(
      table.companyId,
      table.productKey,
      table.externalId,
    ),
    companyProductIdx: index("support_end_users_company_product_idx").on(table.companyId, table.productKey),
  }),
);
