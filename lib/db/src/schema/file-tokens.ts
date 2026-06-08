import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const fileTokensTable = pgTable("file_tokens", {
  token: text("token").primaryKey(),
  filePath: text("file_path").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FileToken = typeof fileTokensTable.$inferSelect;
export type InsertFileToken = typeof fileTokensTable.$inferInsert;
