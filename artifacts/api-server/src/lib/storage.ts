import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

export const STORAGE_ROOT = process.env.STORAGE_PATH
  ? path.resolve(process.env.STORAGE_PATH)
  : path.resolve(workspaceRoot, "storage");

export async function ensureStorageRoot(): Promise<void> {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
}

/**
 * Resolves a user-provided relative path to an absolute path inside STORAGE_ROOT.
 * Throws if the resolved path escapes STORAGE_ROOT (path traversal protection).
 */
export function resolveStoragePath(relativePath: string): string {
  const normalized = path.normalize(relativePath || "").replace(/^[/\\]+/, "");
  const absolute = path.resolve(STORAGE_ROOT, normalized);

  if (!absolute.startsWith(STORAGE_ROOT + path.sep) && absolute !== STORAGE_ROOT) {
    throw new Error("Access denied: path outside storage root");
  }

  return absolute;
}

/**
 * Returns the relative path (from STORAGE_ROOT) for a given absolute path.
 */
export function toRelativePath(absolutePath: string): string {
  return path.relative(STORAGE_ROOT, absolutePath).replace(/\\/g, "/");
}

/**
 * Returns MIME type based on file extension.
 */
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "text/typescript",
    ".json": "application/json",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

export interface FileItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
  mimeType: string | null;
}

/**
 * Build a FileItem from a path and fs.Stats.
 */
export function buildFileItem(absPath: string, stats: import("fs").Stats): FileItem {
  const isDir = stats.isDirectory();
  return {
    name: path.basename(absPath),
    path: toRelativePath(absPath),
    type: isDir ? "directory" : "file",
    size: isDir ? 0 : stats.size,
    modifiedAt: stats.mtime.toISOString(),
    mimeType: isDir ? null : getMimeType(absPath),
  };
}

/**
 * Recursively counts files, directories, and total size.
 */
export async function getStorageStats(dir: string = STORAGE_ROOT): Promise<{
  totalFiles: number;
  totalSize: number;
  totalDirectories: number;
  allFiles: FileItem[];
}> {
  let totalFiles = 0;
  let totalSize = 0;
  let totalDirectories = 0;
  const allFiles: FileItem[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      try {
        const stats = await fs.stat(abs);
        const item = buildFileItem(abs, stats);
        if (entry.isDirectory()) {
          totalDirectories++;
          await walk(abs);
        } else {
          totalFiles++;
          totalSize += stats.size;
          allFiles.push(item);
        }
      } catch {
        // skip inaccessible entries
      }
    }
  }

  if (existsSync(dir)) {
    await walk(dir);
  }

  return { totalFiles, totalSize, totalDirectories, allFiles };
}
