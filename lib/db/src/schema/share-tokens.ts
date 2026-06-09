import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";

export const shareTokensTable = pgTable("share_tokens", {
  token: text("token").primaryKey(),
  filePath: text("file_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  passwordHash: text("password_hash"),
  maxDownloads: integer("max_downloads"),
  downloadCount: integer("download_count").default(0).notNull(),
}, (t) => ({
  createdByIdx: index("share_tokens_created_by_idx").on(t.createdBy),
}));

export type ShareTokenRow = typeof shareTokensTable.$inferSelect;
export type InsertShareToken = typeof shareTokensTable.$inferInsert;
