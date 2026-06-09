import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { db, fileIndexTable } from "@workspace/db";
import { eq, like, or } from "drizzle-orm";
import { STORAGE_ROOT, toRelativePath, getMimeType } from "./storage";

/**
 * Upserts a single file or directory into the index.
 */
export async function indexItem(absPath: string): Promise<void> {
  try {
    const stats = await fs.stat(absPath);
    const relPath = toRelativePath(absPath);
    if (!relPath) return;
    const name = path.basename(relPath);
    const parentPath = relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
    const isDir = stats.isDirectory();
    await db.insert(fileIndexTable).values({
      path: relPath,
      name,
      parentPath,
      isDir,
      size: isDir ? 0 : stats.size,
      mimeType: isDir ? null : getMimeType(absPath),
      modifiedAt: stats.mtime,
    }).onConflictDoUpdate({
      target: fileIndexTable.path,
      set: {
        name,
        parentPath,
        isDir,
        size: isDir ? 0 : stats.size,
        mimeType: isDir ? null : getMimeType(absPath),
        modifiedAt: stats.mtime,
      },
    });
  } catch {
    // Non-critical — index is a read-through cache
  }
}

/**
 * Removes an item and all its descendants from the index.
 */
export async function removeFromIndex(relPath: string): Promise<void> {
  try {
    await db.delete(fileIndexTable).where(
      or(
        eq(fileIndexTable.path, relPath),
        like(fileIndexTable.path, relPath + "/%"),
      )
    );
  } catch {
    // Non-critical
  }
}

/**
 * Updates the index for a moved/renamed item: removes old entries, indexes new path tree.
 */
export async function moveInIndex(oldRelPath: string, newAbsPath: string): Promise<void> {
  await removeFromIndex(oldRelPath);
  await indexSubtree(newAbsPath);
}

/**
 * Recursively indexes a path and all its descendants.
 */
export async function indexSubtree(absPath: string): Promise<void> {
  try {
    const stats = await fs.stat(absPath);
    const relPath = toRelativePath(absPath);
    if (relPath) {
      const name = path.basename(relPath);
      const parentPath = relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
      const isDir = stats.isDirectory();
      await db.insert(fileIndexTable).values({
        path: relPath,
        name,
        parentPath,
        isDir,
        size: isDir ? 0 : stats.size,
        mimeType: isDir ? null : getMimeType(absPath),
        modifiedAt: stats.mtime,
      }).onConflictDoUpdate({
        target: fileIndexTable.path,
        set: {
          name,
          parentPath,
          isDir,
          size: isDir ? 0 : stats.size,
          mimeType: isDir ? null : getMimeType(absPath),
          modifiedAt: stats.mtime,
        },
      });
    }
    if (stats.isDirectory()) {
      await walkAndIndex(absPath);
    }
  } catch {
    // Non-critical
  }
}

async function walkAndIndex(absDir: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    await indexSubtree(path.join(absDir, entry.name));
  }
}

/**
 * Full reindex: clears all entries and re-walks STORAGE_ROOT.
 */
export async function reindexAll(): Promise<{ indexed: number }> {
  await db.delete(fileIndexTable).catch(() => {});
  let count = 0;

  async function walk(absDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(absDir, entry.name);
      const relPath = toRelativePath(abs);
      try {
        const stats = await fs.stat(abs);
        const name = path.basename(relPath);
        const parentPath = relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
        const isDir = stats.isDirectory();
        await db.insert(fileIndexTable).values({
          path: relPath,
          name,
          parentPath,
          isDir,
          size: isDir ? 0 : stats.size,
          mimeType: isDir ? null : getMimeType(abs),
          modifiedAt: stats.mtime,
        }).onConflictDoUpdate({
          target: fileIndexTable.path,
          set: {
            name,
            parentPath,
            isDir,
            size: isDir ? 0 : stats.size,
            mimeType: isDir ? null : getMimeType(abs),
            modifiedAt: stats.mtime,
          },
        });
        count++;
        if (isDir) await walk(abs);
      } catch {
        // skip inaccessible entries
      }
    }
  }

  if (existsSync(STORAGE_ROOT)) {
    await walk(STORAGE_ROOT);
  }
  return { indexed: count };
}
