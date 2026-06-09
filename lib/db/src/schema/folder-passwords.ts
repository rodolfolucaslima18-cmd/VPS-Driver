import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const folderPasswordsTable = pgTable("folder_passwords", {
  path: text("path").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FolderPassword = typeof folderPasswordsTable.$inferSelect;
