import express, { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import multer from "multer";
import { eq, lt, inArray, and, desc, asc, not, like, ilike, or, count } from "drizzle-orm";
import { db, fileTokensTable, folderPasswordsTable, fileAccessLogTable, fileIndexTable } from "@workspace/db";
import {
  STORAGE_ROOT,
  ensureStorageRoot,
  resolveStoragePath,
  toRelativePath,
  buildFileItem,
  getStorageStats,
  getMimeType,
} from "../lib/storage";
import { requireAuth, requireMaster } from "../middlewares/requireAuth";
import { hashPassword, verifyPassword } from "../lib/auth";
import { indexItem, removeFromIndex, moveInIndex, indexSubtree, reindexAll } from "../lib/file-index";
import {
  ListFilesQueryParams,
  DeleteItemQueryParams,
  CreateDirectoryBody,
  RenameItemBody,
} from "@workspace/api-zod";
// ── Periodic cleanup of expired tokens in DB ─────────────────
setInterval(async () => {
  try {
    await db.delete(fileTokensTable).where(lt(fileTokensTable.expiresAt, new Date()));
  } catch {
    // Non-critical — expired rows will simply be ignored at lookup time
  }
}, 10 * 60 * 1000).unref();

// ── File access logging helper ───────────────────────────────
async function logFileAccess(userId: string, filePath: string, mimeType?: string): Promise<void> {
  const fileName = path.basename(filePath);
  try {
    // Remove existing entry for this user+path so the new one becomes most recent
    await db.delete(fileAccessLogTable).where(
      and(eq(fileAccessLogTable.userId, userId), eq(fileAccessLogTable.filePath, filePath))
    );
    await db.insert(fileAccessLogTable).values({ userId, filePath, fileName, mimeType: mimeType ?? null });
    // Keep only the 50 most recent entries per user
    const topRows = await db
      .select({ id: fileAccessLogTable.id })
      .from(fileAccessLogTable)
      .where(eq(fileAccessLogTable.userId, userId))
      .orderBy(desc(fileAccessLogTable.accessedAt))
      .limit(51);
    if (topRows.length === 51) {
      const cutoffId = topRows[topRows.length - 1].id;
      await db.delete(fileAccessLogTable).where(
        and(eq(fileAccessLogTable.userId, userId), lt(fileAccessLogTable.id, cutoffId))
      );
    }
  } catch {
    // Non-critical
  }
}

const router: IRouter = Router();

// Temp directory for multer disk storage — files are moved to STORAGE_ROOT after validation.
// Using disk (not memory) storage so uploads stream directly to disk and never fill RAM,
// which prevents OOM crashes when uploading hundreds of files simultaneously.
const UPLOAD_TMP_DIR = "/tmp/vps-drive-uploads";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
      cb(null, UPLOAD_TMP_DIR);
    },
    filename: (_req, _file, cb) => {
      cb(null, randomUUID());
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
});

// Ensure storage root exists on startup
ensureStorageRoot().catch((err) => {
  console.error("Failed to create storage root:", err);
});

// GET /files — list directory contents (SQL-index backed, O(1) on 1000+ files)
router.get("/files", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListFilesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),   10) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit ?? "200"), 10) || 200));

  let absPath: string;
  try {
    absPath = resolveStoragePath(parsed.data.path ?? "");
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(absPath)) {
    if (absPath === STORAGE_ROOT) {
      res.json({ items: [], total: 0, page: 1, totalPages: 1 });
      return;
    }
    res.status(404).json({ error: "Directory not found" });
    return;
  }

  // Check if the current folder is locked (non-master users)
  const currentFolderPath = parsed.data.path ?? "";
  if (req.session.role !== "master" && currentFolderPath !== "") {
    const [lockRow] = await db
      .select({ path: folderPasswordsTable.path })
      .from(folderPasswordsTable)
      .where(eq(folderPasswordsTable.path, currentFolderPath))
      .limit(1);
    if (lockRow) {
      const unlocked = req.session.unlockedFolders ?? [];
      if (!unlocked.includes(currentFolderPath)) {
        res.status(403).json({ error: "FOLDER_LOCKED", message: "Esta pasta requer senha." });
        return;
      }
    }
  }

  const searchRaw = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const searchLC  = searchRaw.toLowerCase();

  // ── Build SQL WHERE clause ──────────────────────────────────────────────────
  const hideHidden = not(like(fileIndexTable.name, ".%"));

  let whereClause;
  if (searchLC) {
    // Recursive search across the entire subtree of the current folder
    const pathScope = currentFolderPath === ""
      ? undefined
      : or(
          eq(fileIndexTable.parentPath, currentFolderPath),
          like(fileIndexTable.parentPath, currentFolderPath + "/%"),
        );
    whereClause = and(hideHidden, ilike(fileIndexTable.name, `%${searchLC}%`), pathScope);

    // Enforce folder-password visibility: exclude contents of locked (non-unlocked) folders
    if (req.session.role !== "master") {
      const allLocked = await db
        .select({ path: folderPasswordsTable.path })
        .from(folderPasswordsTable);
      const unlockedSet = new Set(req.session.unlockedFolders ?? []);
      for (const { path: lp } of allLocked.filter((r) => !unlockedSet.has(r.path))) {
        whereClause = and(
          whereClause,
          not(or(
            eq(fileIndexTable.parentPath, lp),
            like(fileIndexTable.parentPath, lp + "/%"),
          )!),
        );
      }
    }
  } else {
    whereClause = and(hideHidden, eq(fileIndexTable.parentPath, currentFolderPath));
  }

  // ── Count via index ─────────────────────────────────────────────────────────
  const [{ value: indexTotal }] = await db
    .select({ value: count() })
    .from(fileIndexTable)
    .where(whereClause);

  // ── Disk fallback if index is empty for a known-non-empty directory ─────────
  // (handles the cold-start state before the first reindex)
  if (indexTotal === 0 && !searchLC) {
    const diskEntries = await fs.readdir(absPath, { withFileTypes: true }).catch(() => [] as import("fs").Dirent[]);
    const visible = diskEntries.filter((e) => !e.name.startsWith("."));

    if (visible.length > 0) {
      // Trigger background reindex so subsequent requests use the fast SQL path
      reindexAll().catch((err) => console.error("[file-index] disk-fallback reindexAll:", err));

      const sorted = [...visible].sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return a.name.localeCompare(b.name);
      });

      const total      = sorted.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const pageEntries = sorted.slice((page - 1) * limit, page * limit);

      const BATCH = 20;
      const pageItems: ReturnType<typeof buildFileItem>[] = [];
      for (let i = 0; i < pageEntries.length; i += BATCH) {
        const batch = pageEntries.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async (entry) => {
            const entryPath = path.join(absPath, entry.name);
            try {
              const stats = await fs.stat(entryPath);
              return buildFileItem(entryPath, stats);
            } catch { return null; }
          })
        );
        pageItems.push(...(results.filter(Boolean) as ReturnType<typeof buildFileItem>[]));
      }

      const pageDirPaths = pageItems.filter((i) => i.type === "directory").map((i) => i.path);
      const lockedPaths  = new Set<string>();
      if (pageDirPaths.length > 0) {
        const locked = await db
          .select({ path: folderPasswordsTable.path })
          .from(folderPasswordsTable)
          .where(inArray(folderPasswordsTable.path, pageDirPaths));
        locked.forEach((r) => lockedPaths.add(r.path));
      }

      if (req.session.userId && currentFolderPath !== "") {
        logFileAccess(req.session.userId, currentFolderPath, "inode/directory").catch(() => {});
      }

      res.json({
        items: pageItems.map((item) => ({
          ...item,
          hasPassword: item.type === "directory" ? lockedPaths.has(item.path) : false,
        })),
        total,
        page,
        totalPages,
      });
      return;
    }
  }

  // ── SQL index response ──────────────────────────────────────────────────────
  const total      = indexTotal;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const indexItems = await db
    .select()
    .from(fileIndexTable)
    .where(whereClause)
    .orderBy(desc(fileIndexTable.isDir), asc(fileIndexTable.name))
    .limit(limit)
    .offset((page - 1) * limit);

  const dirPaths   = indexItems.filter((i) => i.isDir).map((i) => i.path);
  const lockedPaths = new Set<string>();
  if (dirPaths.length > 0) {
    const locked = await db
      .select({ path: folderPasswordsTable.path })
      .from(folderPasswordsTable)
      .where(inArray(folderPasswordsTable.path, dirPaths));
    locked.forEach((r) => lockedPaths.add(r.path));
  }

  if (req.session.userId && currentFolderPath !== "") {
    logFileAccess(req.session.userId, currentFolderPath, "inode/directory").catch(() => {});
  }

  res.json({
    items: indexItems.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.isDir ? "directory" : "file",
      size: item.size ?? 0,
      modifiedAt: item.modifiedAt.toISOString(),
      mimeType: item.mimeType,
      hasPassword: item.isDir ? lockedPaths.has(item.path) : false,
    })),
    total,
    page,
    totalPages,
  });
});

// GET /files/download — download a file
router.get("/files/download", requireAuth, async (req, res): Promise<void> => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!rawPath) {
    res.status(400).json({ error: "Missing path" });
    return;
  }

  let absPath: string;
  try {
    absPath = resolveStoragePath(rawPath);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(absPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  let stats: import("fs").Stats;
  try {
    stats = await fs.stat(absPath);
  } catch {
    res.status(500).json({ error: "Cannot stat file" });
    return;
  }

  if (stats.isDirectory()) {
    res.status(400).json({ error: "Cannot download a directory" });
    return;
  }

  const filename = path.basename(absPath);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", stats.size);

  logFileAccess(req.session.userId!, rawPath, getMimeType(absPath)).catch(() => {});

  const stream = createReadStream(absPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Error reading file" });
    }
  });
  stream.pipe(res);
});

// Multer error handler — must be Express error middleware (4 args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleMulterError(err: any, _req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (err?.name === "MulterError") {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: "Arquivo muito grande. O limite por arquivo é 500 MB.",
      LIMIT_FILE_COUNT: "Muitos arquivos enviados de uma vez.",
      LIMIT_UNEXPECTED_FILE: "Campo de arquivo inesperado.",
    };
    res.status(413).json({ error: messages[err.code as string] ?? `Erro no envio: ${err.message}` });
    return;
  }
  next(err);
}

// POST /files/upload — upload files
router.post(
  "/files/upload",
  requireAuth,
  upload.array("files"),
  handleMulterError,
  async (req: express.Request, res: express.Response): Promise<void> => {
    // Capture req.files immediately — multer has already written them to UPLOAD_TMP_DIR
    // by the time this handler runs. cleanupTempFiles() is called on every early-return
    // error path so no orphaned files are left in /tmp.
    const files = req.files as Express.Multer.File[] | undefined;

    async function cleanupTempFiles(): Promise<void> {
      if (!files?.length) return;
      await Promise.allSettled(files.map((f) => fs.unlink(f.path).catch(() => {})));
    }

    const targetPath = typeof req.body.path === "string" ? req.body.path : "";

    let absDir: string;
    try {
      absDir = resolveStoragePath(targetPath);
    } catch {
      await cleanupTempFiles();
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    try {
      await fs.mkdir(absDir, { recursive: true });
    } catch (err) {
      await cleanupTempFiles();
      throw err;
    }

    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    // Optional relative paths for folder uploads (JSON array, one entry per file)
    let relativePaths: string[] = [];
    if (req.body.relativePaths) {
      try {
        const parsed = JSON.parse(req.body.relativePaths);
        if (Array.isArray(parsed)) relativePaths = parsed;
      } catch {
        // ignore malformed value — treat as flat upload
      }
    }

    // Helper: move temp file to dest, cleaning up the temp on any failure.
    // fs.rename is atomic on the same filesystem; falls back to copy+unlink across devices.
    async function moveTempFile(tmpPath: string, destPath: string): Promise<void> {
      try {
        await fs.rename(tmpPath, destPath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "EXDEV") {
          // Cross-device (e.g. /tmp and storage on different mount points)
          await fs.copyFile(tmpPath, destPath);
          await fs.unlink(tmpPath).catch(() => {});
        } else {
          await fs.unlink(tmpPath).catch(() => {});
          throw err;
        }
      }
    }

    let uploaded: ReturnType<typeof buildFileItem>[];
    try {
      uploaded = await Promise.all(
        files.map(async (file, i) => {
          const relPath = relativePaths[i];
          let destPath: string;

          if (relPath && typeof relPath === "string") {
            // Normalize path: forward slashes only, no leading slash
            const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
            // Security: reject ".." segments
            const segments = normalized.split("/");
            if (segments.some((s) => s === ".." || s === ".")) {
              // Fallback to safe basename
              const safeName = path.basename(file.originalname).replace(/[/\\]/g, "_") || "upload";
              destPath = resolveStoragePath(path.join(path.relative(STORAGE_ROOT, absDir), safeName));
            } else {
              destPath = resolveStoragePath(path.join(path.relative(STORAGE_ROOT, absDir), normalized));
              await fs.mkdir(path.dirname(destPath), { recursive: true });
            }
          } else {
            // Plain upload: strip any directory separators from the original filename
            const safeName = path.basename(file.originalname).replace(/[/\\]/g, "_") || "upload";
            destPath = resolveStoragePath(path.join(path.relative(STORAGE_ROOT, absDir), safeName));
          }

          await moveTempFile(file.path, destPath);
          const stats = await fs.stat(destPath);
          return buildFileItem(destPath, stats);
        })
      );
    } catch (err) {
      // Clean up any temp files that weren't moved (e.g. files after the one that threw)
      await cleanupTempFiles();
      throw err;
    }

    // Fire-and-forget: log each uploaded file as recently accessed
    const userId = req.session.userId!;
    for (const uploadedFile of uploaded) {
      logFileAccess(userId, uploadedFile.path, uploadedFile.mimeType ?? undefined).catch(() => {});
    }

    // Await index updates (best-effort; errors logged but do not fail the upload response)
    await Promise.allSettled(
      uploaded.flatMap((uploadedFile) => {
        const tasks: Promise<void>[] = [];
        tasks.push(
          indexItem(path.join(STORAGE_ROOT, uploadedFile.path))
            .catch((err) => { console.error("[file-index] upload indexItem:", err); })
        );
        let rel = uploadedFile.path;
        while (rel.includes("/")) {
          rel = rel.substring(0, rel.lastIndexOf("/"));
          tasks.push(
            indexItem(path.join(STORAGE_ROOT, rel))
              .catch((err) => { console.error("[file-index] upload parent indexItem:", err); })
          );
        }
        return tasks;
      })
    );

    res.json(uploaded);
  }
);

// POST /files/mkdir — create directory
router.post("/files/mkdir", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateDirectoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let absPath: string;
  try {
    absPath = resolveStoragePath(parsed.data.path);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (existsSync(absPath)) {
    res.status(400).json({ error: "Directory already exists" });
    return;
  }

  await fs.mkdir(absPath, { recursive: true });
  const stats = await fs.stat(absPath);

  // Index the leaf directory AND all intermediate ancestors that were created by the
  // recursive mkdir (e.g. creating "a/b/c" also creates "a" and "a/b").
  // indexItem is an upsert, so re-indexing an existing directory is safe.
  const relLeaf = toRelativePath(absPath);
  const parts = relLeaf ? relLeaf.split("/") : [];
  for (let i = 1; i <= parts.length; i++) {
    const ancestorAbs = path.join(STORAGE_ROOT, parts.slice(0, i).join("/"));
    try { await indexItem(ancestorAbs); } catch (err) { console.error("[file-index] mkdir indexItem:", err); }
  }

  res.status(201).json(buildFileItem(absPath, stats));
});

// PATCH /files/rename — rename or move
router.patch("/files/rename", requireAuth, async (req, res): Promise<void> => {
  const parsed = RenameItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let oldAbs: string;
  let newAbs: string;
  try {
    oldAbs = resolveStoragePath(parsed.data.oldPath);
    newAbs = resolveStoragePath(parsed.data.newPath);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(oldAbs)) {
    res.status(404).json({ error: "File or folder not found" });
    return;
  }

  if (existsSync(newAbs)) {
    res.status(400).json({ error: "Target path already exists" });
    return;
  }

  // Ensure parent directory of new path exists
  await fs.mkdir(path.dirname(newAbs), { recursive: true });
  await fs.rename(oldAbs, newAbs);
  try { await moveInIndex(parsed.data.oldPath, newAbs); } catch (err) { console.error("[file-index] rename moveInIndex:", err); }

  const stats = await fs.stat(newAbs);
  res.json(buildFileItem(newAbs, stats));
});

// DELETE /files — delete file or folder
router.delete("/files", requireAuth, async (req, res): Promise<void> => {
  const parsed = DeleteItemQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let absPath: string;
  try {
    absPath = resolveStoragePath(parsed.data.path);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  // Prevent deleting storage root
  if (absPath === STORAGE_ROOT) {
    res.status(400).json({ error: "Cannot delete storage root" });
    return;
  }

  if (!existsSync(absPath)) {
    res.status(404).json({ error: "File or folder not found" });
    return;
  }

  try {
    await fs.rm(absPath, { recursive: true, force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Não foi possível excluir: ${msg}` });
    return;
  }
  try { await removeFromIndex(parsed.data.path); } catch (err) { console.error("[file-index] delete removeFromIndex:", err); }
  res.sendStatus(204);
});

// GET /files/office-html — convert DOCX/DOC to HTML via mammoth (requires auth)
router.get("/files/office-html", requireAuth, async (req, res): Promise<void> => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!rawPath) { res.status(400).json({ error: "Missing path" }); return; }

  let absPath: string;
  try {
    absPath = resolveStoragePath(rawPath);
  } catch {
    res.status(400).json({ error: "Invalid path" }); return;
  }

  if (!existsSync(absPath)) { res.status(404).json({ error: "File not found" }); return; }

  // Supported: .docx (OOXML, reliable) and .doc (attempted; may fail for binary BIFF)
  const allowedExts = [".docx", ".doc"];
  const fileExt = path.extname(rawPath).toLowerCase();
  if (!allowedExts.includes(fileExt)) {
    res.status(415).json({
      error: `Formato não suportado (${fileExt}). Apenas .docx e .doc são aceitos.`,
    });
    return;
  }

  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat || stat.isDirectory()) { res.status(400).json({ error: "Not a file" }); return; }

  try {
    // Dynamic import keeps mammoth out of the main bundle for non-office requests
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ path: absPath });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Mammoth-Warnings", String(result.messages.length));
    res.send(result.value || "<p>(documento sem conteúdo de texto)</p>");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Conversion failed";
    res.status(422).json({ error: `Não foi possível converter o documento: ${msg}` });
  }
});

// GET /files/preview — serve file inline for browser preview
router.get("/files/preview", requireAuth, async (req, res): Promise<void> => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!rawPath) {
    res.status(400).json({ error: "Missing path" });
    return;
  }

  let absPath: string;
  try {
    absPath = resolveStoragePath(rawPath);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(absPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  let stats: import("fs").Stats;
  try {
    stats = await fs.stat(absPath);
  } catch {
    res.status(500).json({ error: "Cannot stat file" });
    return;
  }

  if (stats.isDirectory()) {
    res.status(400).json({ error: "Cannot preview a directory" });
    return;
  }

  const mimeType = getMimeType(absPath);

  logFileAccess(req.session.userId!, rawPath, mimeType).catch(() => {});

  const TEXT_MIME_PREFIXES = ["text/"];
  const TEXT_MIME_TYPES = [
    "application/json",
    "application/javascript",
    "application/xml",
    "image/svg+xml",
  ];
  const TEXT_LIMIT = 200 * 1024; // 200 KB

  const isText =
    TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    TEXT_MIME_TYPES.includes(mimeType);

  if (isText) {
    const fileSize = stats.size;
    if (fileSize > TEXT_LIMIT) {
      res.status(200).json({ truncated: true, size: fileSize });
      return;
    }
    const content = await fs.readFile(absPath, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "inline");
    res.send(content);
    return;
  }

  // Binary: stream inline
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Content-Length", stats.size);

  const stream = createReadStream(absPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Error reading file" });
    }
  });
  stream.pipe(res);
});

// Office extensions allowed for public tokenization
const OFFICE_EXTENSIONS = new Set([".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"]);

function hasOfficeExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return OFFICE_EXTENSIONS.has(ext);
}

// GET /files/token — generate a 30-min public-access token for an Office file
router.get("/files/token", requireAuth, async (req, res): Promise<void> => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!rawPath) { res.status(400).json({ error: "Missing path" }); return; }

  if (!hasOfficeExtension(rawPath)) {
    res.status(400).json({ error: "Tokens are only supported for Office documents (.docx, .xlsx, .pptx, .doc, .xls, .ppt)." });
    return;
  }

  let absPath: string;
  try { absPath = resolveStoragePath(rawPath); } catch { res.status(400).json({ error: "Invalid path" }); return; }

  if (!existsSync(absPath)) { res.status(404).json({ error: "File not found" }); return; }

  let stats: import("fs").Stats;
  try { stats = await fs.stat(absPath); } catch { res.status(500).json({ error: "Cannot stat file" }); return; }
  if (stats.isDirectory()) { res.status(400).json({ error: "Cannot tokenize a directory" }); return; }

  const token = randomUUID();
  const TTL_MS = 30 * 60 * 1000;
  const expiresAt = new Date(Date.now() + TTL_MS);

  try {
    await db.insert(fileTokensTable).values({ token, filePath: rawPath, expiresAt });
  } catch (err) {
    console.error("Failed to persist file token:", err);
    res.status(500).json({ error: "Não foi possível criar o token." });
    return;
  }

  // Prefer VPS_HOST from env (set during install) to avoid leaking internal/proxy hostnames.
  // COOKIE_SECURE=true iff HTTPS is enabled, so it doubles as the scheme signal.
  const vpsHost = process.env.VPS_HOST;
  const proto = vpsHost
    ? (process.env.COOKIE_SECURE === "true" ? "https" : "http")
    : ((req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol);
  const host = vpsHost ?? req.get("host");
  const publicUrl = `${proto}://${host}/api/files/public/${token}`;

  res.json({ token, publicUrl, expiresAt: expiresAt.toISOString() });
});

// Shared handler for HEAD and GET /files/public/:token — no auth required
async function servePublicToken(req: express.Request, res: express.Response, headOnly: boolean): Promise<void> {
  const token = typeof req.params.token === "string" ? req.params.token : "";

  let entry: { filePath: string; expiresAt: Date } | undefined;
  try {
    const [row] = await db
      .select({ filePath: fileTokensTable.filePath, expiresAt: fileTokensTable.expiresAt })
      .from(fileTokensTable)
      .where(eq(fileTokensTable.token, token ?? ""))
      .limit(1);
    entry = row;
  } catch (err) {
    console.error("Token lookup failed:", err);
    res.status(500).json({ error: "Erro interno ao validar token." });
    return;
  }

  if (!entry || entry.expiresAt < new Date()) {
    db.delete(fileTokensTable).where(eq(fileTokensTable.token, token ?? "")).catch(() => {});
    res.status(404).json({ error: "Token inválido ou expirado." });
    return;
  }

  let absPath: string;
  try { absPath = resolveStoragePath(entry.filePath); } catch { res.status(400).json({ error: "Invalid path" }); return; }

  if (!existsSync(absPath)) { res.status(404).json({ error: "File not found" }); return; }

  let stats: import("fs").Stats;
  try { stats = await fs.stat(absPath); } catch { res.status(500).json({ error: "Cannot stat file" }); return; }

  const filename = path.basename(absPath);
  const mimeType = getMimeType(absPath);

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Content-Length", stats.size);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");

  if (headOnly) {
    res.end();
    return;
  }

  const stream = createReadStream(absPath);
  stream.on("error", () => { if (!res.headersSent) res.status(500).json({ error: "Error reading file" }); });
  stream.pipe(res);
}

// HEAD /files/public/:token — Office Online inspects the file with HEAD before rendering
router.head("/files/public/:token", (req, res) => servePublicToken(req, res, true));

// GET /files/public/:token — serve a tokenized file publicly (no auth required)
router.get("/files/public/:token", (req, res) => servePublicToken(req, res, false));

// GET /files/edit-session — generate a 4-hour edit session for OnlyOffice
router.get("/files/edit-session", requireAuth, async (req, res): Promise<void> => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!rawPath) { res.status(400).json({ error: "Missing path" }); return; }

  if (!hasOfficeExtension(rawPath)) {
    res.status(400).json({ error: "Edição suportada apenas para arquivos Office (.docx, .xlsx, .pptx, .doc, .xls, .ppt)." });
    return;
  }

  let absPath: string;
  try { absPath = resolveStoragePath(rawPath); } catch { res.status(400).json({ error: "Invalid path" }); return; }
  if (!existsSync(absPath)) { res.status(404).json({ error: "File not found" }); return; }

  let stats: import("fs").Stats;
  try { stats = await fs.stat(absPath); } catch { res.status(500).json({ error: "Cannot stat file" }); return; }
  if (stats.isDirectory()) { res.status(400).json({ error: "Cannot edit a directory" }); return; }

  // Token TTL is 4 hours per user request (allows editing sessions without interruption)
  const TTL_MS = 4 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + TTL_MS);

  // fileToken — used by OnlyOffice to fetch the original file via the public endpoint
  const fileToken = randomUUID();
  // callbackToken — one-time secret included in callbackUrl to authenticate OnlyOffice callbacks
  const callbackToken = randomUUID();
  // sessionKey — unique document key required by OnlyOffice to identify the editing session
  const sessionKey = randomUUID();

  try {
    await db.insert(fileTokensTable).values([
      { token: fileToken, filePath: rawPath, expiresAt },
      // callbackToken stored with a special prefix so it can be identified and deleted after use
      { token: callbackToken, filePath: `__callback__:${rawPath}`, expiresAt },
    ]);
  } catch (err) {
    console.error("Failed to persist edit session tokens:", err);
    res.status(500).json({ error: "Não foi possível criar a sessão de edição." });
    return;
  }

  const vpsHost = process.env.VPS_HOST;
  const proto = vpsHost
    ? (process.env.COOKIE_SECURE === "true" ? "https" : "http")
    : ((req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol);
  const host = vpsHost ?? req.get("host");
  const baseUrl = `${proto}://${host}`;

  const onlyOfficeUrl = (process.env.ONLYOFFICE_URL ?? "").replace(/\/$/, "");
  const fileExt = rawPath.slice(rawPath.lastIndexOf(".") + 1).toLowerCase();
  const fileName = path.basename(rawPath);

  res.json({
    documentServerUrl: onlyOfficeUrl,
    fileUrl: `${baseUrl}/api/files/public/${fileToken}`,
    callbackUrl: `${baseUrl}/api/files/onlyoffice/callback?path=${encodeURIComponent(rawPath)}&token=${callbackToken}`,
    fileName,
    fileType: fileExt,
    key: sessionKey,
  });
});

// POST /files/onlyoffice/callback — OnlyOffice calls this when a document is saved.
// Authentication: requires a one-time callbackToken generated by /files/edit-session.
// OnlyOffice includes it in the callbackUrl — without it any write is rejected.
router.post("/files/onlyoffice/callback", express.json(), async (req, res): Promise<void> => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  const callbackToken = typeof req.query.token === "string" ? req.query.token : "";

  // Verify one-time callback token before doing anything
  if (!rawPath || !callbackToken) {
    console.warn("OnlyOffice callback: missing path or token — rejected");
    res.status(403).json({ error: 1 });
    return;
  }

  try {
    const [row] = await db
      .select({ filePath: fileTokensTable.filePath, expiresAt: fileTokensTable.expiresAt })
      .from(fileTokensTable)
      .where(eq(fileTokensTable.token, callbackToken))
      .limit(1);

    if (!row || row.expiresAt < new Date()) {
      console.warn("OnlyOffice callback: invalid or expired token — rejected");
      res.status(403).json({ error: 1 });
      return;
    }

    const expectedFilePath = `__callback__:${rawPath}`;
    if (row.filePath !== expectedFilePath) {
      console.warn("OnlyOffice callback: token path mismatch — rejected");
      res.status(403).json({ error: 1 });
      return;
    }
  } catch (err) {
    console.error("OnlyOffice callback: token lookup failed:", err);
    res.status(500).json({ error: 1 });
    return;
  }

  const body = req.body as { status?: number; url?: string };
  const status = body?.status;

  // status=2: document saved and ready for download — overwrite original file
  if (status === 2) {
    const downloadUrl = body.url;
    if (!downloadUrl) {
      console.error("OnlyOffice callback: status=2 but no url in body");
      res.json({ error: 1 });
      return;
    }

    let absPath: string;
    try { absPath = resolveStoragePath(rawPath); } catch {
      console.error("OnlyOffice callback: invalid path", rawPath);
      res.json({ error: 1 });
      return;
    }

    try {
      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      await fs.writeFile(absPath, buffer);
      console.log(`OnlyOffice: saved "${rawPath}" (${buffer.length} bytes)`);
    } catch (err) {
      console.error("OnlyOffice callback: failed to save file:", err);
      res.json({ error: 1 });
      return;
    }

    // Delete the one-time callback token after a successful save so it cannot be reused
    db.delete(fileTokensTable).where(eq(fileTokensTable.token, callbackToken)).catch(() => {});
  }
  // status=1: being edited; status=4|6: closed without changes — nothing to do

  res.json({ error: 0 });
});

// POST /files/folder-password — set or remove a folder password (master only)
router.post("/files/folder-password", requireMaster, async (req, res): Promise<void> => {
  const { path: folderPath, password } = req.body as { path?: string; password?: string | null };
  if (!folderPath) { res.status(400).json({ error: "Missing path" }); return; }

  let absPath: string;
  try { absPath = resolveStoragePath(folderPath); } catch { res.status(400).json({ error: "Invalid path" }); return; }
  if (!existsSync(absPath)) { res.status(404).json({ error: "Folder not found" }); return; }

  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat?.isDirectory()) { res.status(400).json({ error: "Path is not a directory" }); return; }

  if (!password) {
    // Remove password
    await db.delete(folderPasswordsTable).where(eq(folderPasswordsTable.path, folderPath));
    res.json({ removed: true });
    return;
  }

  const passwordHash = await hashPassword(password);
  await db
    .insert(folderPasswordsTable)
    .values({ path: folderPath, passwordHash })
    .onConflictDoUpdate({ target: folderPasswordsTable.path, set: { passwordHash } });

  res.json({ set: true });
});

// POST /files/unlock-folder — verify a folder password and store unlock in session
router.post("/files/unlock-folder", requireAuth, async (req, res): Promise<void> => {
  const { path: folderPath, password } = req.body as { path?: string; password?: string };
  if (!folderPath || !password) { res.status(400).json({ error: "Missing path or password" }); return; }

  const [row] = await db
    .select({ passwordHash: folderPasswordsTable.passwordHash })
    .from(folderPasswordsTable)
    .where(eq(folderPasswordsTable.path, folderPath))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Folder not protected" }); return; }

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) { res.status(401).json({ error: "WRONG_PASSWORD" }); return; }

  // Store unlocked folder in session
  const current = req.session.unlockedFolders ?? [];
  if (!current.includes(folderPath)) {
    req.session.unlockedFolders = [...current, folderPath];
  }
  res.json({ unlocked: true });
});

// GET /files/recent — return 10 most recently accessed files for the current user
router.get("/files/recent", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const rows = await db
    .select()
    .from(fileAccessLogTable)
    .where(eq(fileAccessLogTable.userId, userId))
    .orderBy(desc(fileAccessLogTable.accessedAt))
    .limit(10);

  res.json(rows.map((r) => ({
    path: r.filePath,
    name: r.fileName,
    mimeType: r.mimeType,
    accessedAt: r.accessedAt.toISOString(),
  })));
});

// POST /files/bulk-delete — delete multiple files/folders at once
router.post("/files/bulk-delete", requireAuth, async (req, res): Promise<void> => {
  const { paths } = req.body as { paths?: unknown };
  if (!Array.isArray(paths) || paths.length === 0) {
    res.status(400).json({ error: "Missing or empty paths array" });
    return;
  }

  const deleted: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  await Promise.all(
    (paths as string[]).map(async (rawPath) => {
      try {
        const absPath = resolveStoragePath(rawPath);
        if (absPath === STORAGE_ROOT) {
          failed.push({ path: rawPath, error: "Cannot delete storage root" });
          return;
        }
        if (!existsSync(absPath)) {
          failed.push({ path: rawPath, error: "Not found" });
          return;
        }
        await fs.rm(absPath, { recursive: true, force: true });
        deleted.push(rawPath);
        try { await removeFromIndex(rawPath); } catch (err) { console.error("[file-index] bulk-delete removeFromIndex:", err); }
      } catch (err) {
        failed.push({ path: rawPath, error: err instanceof Error ? err.message : "Unknown error" });
      }
    })
  );

  res.json({ deleted, failed });
});

// POST /files/bulk-move — move multiple files/folders to a destination directory
router.post("/files/bulk-move", requireAuth, async (req, res): Promise<void> => {
  const { paths, destDir } = req.body as { paths?: unknown; destDir?: unknown };
  if (!Array.isArray(paths) || paths.length === 0) {
    res.status(400).json({ error: "Missing or empty paths array" });
    return;
  }
  const targetDir = typeof destDir === "string" ? destDir : "";

  const moved: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  await Promise.all(
    (paths as string[]).map(async (rawPath) => {
      try {
        const srcAbs = resolveStoragePath(rawPath);
        if (!existsSync(srcAbs)) {
          failed.push({ path: rawPath, error: "Source not found" });
          return;
        }
        const itemName = path.basename(rawPath);
        const destPath = targetDir ? `${targetDir}/${itemName}` : itemName;
        const dstAbs = resolveStoragePath(destPath);
        if (dstAbs === srcAbs) {
          failed.push({ path: rawPath, error: "Source and destination are the same" });
          return;
        }
        if (existsSync(dstAbs)) {
          failed.push({ path: rawPath, error: "Destination already exists" });
          return;
        }
        if (dstAbs.startsWith(srcAbs + path.sep)) {
          failed.push({ path: rawPath, error: "Cannot move folder into itself" });
          return;
        }
        await fs.mkdir(path.dirname(dstAbs), { recursive: true });
        await fs.rename(srcAbs, dstAbs);
        moved.push(rawPath);
        try { await moveInIndex(rawPath, dstAbs); } catch (err) { console.error("[file-index] bulk-move moveInIndex:", err); }
      } catch (err) {
        failed.push({ path: rawPath, error: err instanceof Error ? err.message : "Unknown error" });
      }
    })
  );

  res.json({ moved, failed });
});

// POST /files/move — move a file or folder to a new location
router.post("/files/move", requireAuth, async (req, res): Promise<void> => {
  const { sourcePath, destPath } = req.body as { sourcePath?: string; destPath?: string };
  if (!sourcePath || !destPath) {
    res.status(400).json({ error: "Missing sourcePath or destPath" });
    return;
  }

  let srcAbs: string;
  let dstAbs: string;
  try {
    srcAbs = resolveStoragePath(sourcePath);
    dstAbs = resolveStoragePath(destPath);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(srcAbs)) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  if (existsSync(dstAbs)) {
    res.status(400).json({ error: "Destination already exists" });
    return;
  }
  if (dstAbs === srcAbs || dstAbs.startsWith(srcAbs + path.sep)) {
    res.status(400).json({ error: "Cannot move a folder into itself" });
    return;
  }

  await fs.mkdir(path.dirname(dstAbs), { recursive: true });
  await fs.rename(srcAbs, dstAbs);
  try { await moveInIndex(sourcePath, dstAbs); } catch (err) { console.error("[file-index] move moveInIndex:", err); }

  const stats = await fs.stat(dstAbs);
  res.json(buildFileItem(dstAbs, stats));
});

// POST /files/copy — recursively copy a file or folder
router.post("/files/copy", requireAuth, async (req, res): Promise<void> => {
  const { sourcePath, destPath } = req.body as { sourcePath?: string; destPath?: string };
  if (!sourcePath || !destPath) {
    res.status(400).json({ error: "Missing sourcePath or destPath" });
    return;
  }

  let srcAbs: string;
  let dstAbs: string;
  try {
    srcAbs = resolveStoragePath(sourcePath);
    dstAbs = resolveStoragePath(destPath);
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(srcAbs)) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  if (existsSync(dstAbs)) {
    res.status(400).json({ error: "Destination already exists" });
    return;
  }
  if (dstAbs === srcAbs || dstAbs.startsWith(srcAbs + path.sep)) {
    res.status(400).json({ error: "Cannot copy a folder into itself" });
    return;
  }

  async function copyRecursive(src: string, dst: string): Promise<void> {
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
      await fs.mkdir(dst, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });
      await Promise.all(entries.map((e) => copyRecursive(path.join(src, e.name), path.join(dst, e.name))));
    } else {
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
    }
  }

  await copyRecursive(srcAbs, dstAbs);
  try { await indexSubtree(dstAbs); } catch (err) { console.error("[file-index] copy indexSubtree:", err); }

  const stats = await fs.stat(dstAbs);
  res.json(buildFileItem(dstAbs, stats));
});

// POST /files/reindex — full rebuild of the file index (master only)
router.post("/files/reindex", requireMaster, async (_req, res): Promise<void> => {
  try {
    const { indexed } = await reindexAll();
    res.json({ indexed, message: `Reindex completo: ${indexed} item(s) indexado(s).` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Reindex falhou: ${msg}` });
  }
});

// GET /files/stats — storage statistics
router.get("/files/stats", requireAuth, async (_req, res): Promise<void> => {
  const { totalFiles, totalSize, totalDirectories, allFiles } =
    await getStorageStats();

  // Sort by modified date, take the 10 most recent files
  const recentFiles = [...allFiles]
    .sort(
      (a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    )
    .slice(0, 10);

  res.json({
    totalFiles,
    totalSize,
    totalDirectories,
    recentFiles,
  });
});

// ── Guarantee file_index table exists (idempotent, runs before any route) ─────
// This is a safety net in case the deployment did not run `drizzle-kit push`.
// The CREATE TABLE IF NOT EXISTS is a no-op if the table already exists.
(async () => {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS file_index (
        path        TEXT        PRIMARY KEY NOT NULL,
        name        TEXT        NOT NULL,
        parent_path TEXT        NOT NULL,
        is_dir      BOOLEAN     NOT NULL DEFAULT false,
        size        BIGINT,
        mime_type   TEXT,
        modified_at TIMESTAMP   NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS file_index_parent_path_idx ON file_index (parent_path);
      CREATE INDEX IF NOT EXISTS file_index_name_idx         ON file_index (name);
    `);
  } catch (err) {
    console.error("[VPS Drive] Could not ensure file_index table:", err);
  }
})();

// ── Auto-reindex on startup if index is empty but storage has files ───────────
// This runs once when the module is loaded (server start / PM2 restart after deploy).
// Note on consistency model: index mutations on write routes are awaited and errors
// are logged. If a transient DB error causes an index update to fail, GET /api/files
// will fall back to disk on next request and trigger a background reindexAll(), so
// the index self-heals without manual intervention.
(async () => {
  try {
    const [{ value: cnt }] = await db.select({ value: count() }).from(fileIndexTable);
    if (cnt === 0 && existsSync(STORAGE_ROOT)) {
      const entries = await fs.readdir(STORAGE_ROOT).catch(() => [] as string[]);
      const visible = entries.filter((e: string) => !e.startsWith("."));
      if (visible.length > 0) {
        console.log("[VPS Drive] File index empty — running background reindex...");
        reindexAll()
          .then(({ indexed }) => console.log(`[VPS Drive] Reindex complete: ${indexed} items`))
          .catch((err) => console.error("[VPS Drive] Reindex error:", err));
      }
    }
  } catch {
    // Non-critical — index will be built lazily on first request
  }
})();

export default router;
