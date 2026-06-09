import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const fileAccessLogTable = pgTable("file_access_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userAccessedIdx: index("file_access_log_user_accessed_idx").on(t.userId, t.accessedAt),
}));

export type FileAccessLog = typeof fileAccessLogTable.$inferSelect;
export type InsertFileAccessLog = typeof fileAccessLogTable.$inferInsert;
