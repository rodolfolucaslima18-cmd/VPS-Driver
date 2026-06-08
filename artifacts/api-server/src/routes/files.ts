import express, { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { randomUUID } from "crypto";
import multer from "multer";
import { eq, lt } from "drizzle-orm";
import { db, fileTokensTable } from "@workspace/db";
import {
  STORAGE_ROOT,
  ensureStorageRoot,
  resolveStoragePath,
  buildFileItem,
  getStorageStats,
  getMimeType,
} from "../lib/storage";
import { requireAuth } from "../middlewares/requireAuth";
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

const router: IRouter = Router();

// Multer: store uploads in memory temporarily, then move to storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
});

// Ensure storage root exists on startup
ensureStorageRoot().catch((err) => {
  console.error("Failed to create storage root:", err);
});

// GET /files — list directory contents
router.get("/files", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListFilesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let absPath: string;
  try {
    absPath = resolveStoragePath(parsed.data.path ?? "");
  } catch {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  if (!existsSync(absPath)) {
    // Return empty array if root doesn't exist yet
    if (absPath === STORAGE_ROOT) {
      res.json([]);
      return;
    }
    res.status(404).json({ error: "Directory not found" });
    return;
  }

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch {
    res.status(400).json({ error: "Not a directory or cannot read" });
    return;
  }

  const items = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith("."))
      .map(async (entry) => {
        const entryPath = path.join(absPath, entry.name);
        try {
          const stats = await fs.stat(entryPath);
          return buildFileItem(entryPath, stats);
        } catch {
          return null;
        }
      })
  );

  const validItems = items.filter(Boolean);
  // Directories first, then files, both sorted by name
  validItems.sort((a, b) => {
    if (!a || !b) return 0;
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  res.json(validItems.filter(Boolean));
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
    const targetPath = typeof req.body.path === "string" ? req.body.path : "";

    let absDir: string;
    try {
      absDir = resolveStoragePath(targetPath);
    } catch {
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    await fs.mkdir(absDir, { recursive: true });

    const files = req.files as Express.Multer.File[] | undefined;
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

    const uploaded = await Promise.all(
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

        await fs.writeFile(destPath, file.buffer);
        const stats = await fs.stat(destPath);
        return buildFileItem(destPath, stats);
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

// GET /files/public/:token — serve a tokenized file publicly (no auth required)
router.get("/files/public/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

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
    // Clean up expired row opportunistically (ignore errors)
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
  res.setHeader("Cache-Control", "no-store");

  const stream = createReadStream(absPath);
  stream.on("error", () => { if (!res.headersSent) res.status(500).json({ error: "Error reading file" }); });
  stream.pipe(res);
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

export default router;
