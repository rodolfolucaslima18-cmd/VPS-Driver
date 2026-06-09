import { pgTable, text, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";

export const fileIndexTable = pgTable("file_index", {
  path: text("path").primaryKey(),
  name: text("name").notNull(),
  parentPath: text("parent_path").notNull(),
  isDir: boolean("is_dir").notNull(),
  size: integer("size").notNull().default(0),
  mimeType: text("mime_type"),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull(),
}, (t) => ({
  parentPathIdx: index("file_index_parent_path_idx").on(t.parentPath),
  nameIdx: index("file_index_name_idx").on(t.name),
}));

export type FileIndex = typeof fileIndexTable.$inferSelect;
export type InsertFileIndex = typeof fileIndexTable.$inferInsert;
