import express, { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { randomUUID } from "crypto";
import multer from "multer";
import { eq, lt, inArray } from "drizzle-orm";
import { db, fileTokensTable, folderPasswordsTable } from "@workspace/db";
import {
  STORAGE_ROOT,
  ensureStorageRoot,
  resolveStoragePath,
  buildFileItem,
  getStorageStats,
  getMimeType,
} from "../lib/storage";
import { requireAuth, requireMaster } from "../middlewares/requireAuth";
import { hashPassword, verifyPassword } from "../lib/auth";
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

  // Pagination params — read directly from query to avoid touching generated schema
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
    // Return empty list if root doesn't exist yet
    if (absPath === STORAGE_ROOT) {
      res.json({ items: [], total: 0, page: 1, totalPages: 1 });
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

  // Check if the current path itself is locked (non-master users)
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

  // Optional search filter (case-insensitive substring match on filename)
  const searchRaw = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const searchLC  = searchRaw.toLowerCase();

  // Sort using Dirent.isDirectory() — no stat needed to order dirs-first alphabetically
  const visible = entries
    .filter((e) => !e.name.startsWith("."))
    .filter((e) => !searchLC || e.name.toLowerCase().includes(searchLC))
    .sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });

  const total      = visible.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pageEntries = visible.slice((page - 1) * limit, page * limit);

  // Stat only the items on this page, using bounded-concurrency batches of 20
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
        } catch {
          return null;
        }
      })
    );
    pageItems.push(...(results.filter(Boolean) as ReturnType<typeof buildFileItem>[]));
  }

  // Enrich only page directories with hasPassword flag
  const pageDirPaths = pageItems.filter((i) => i.type === "directory").map((i) => i.path);
  const lockedPaths = new Set<string>();
  if (pageDirPaths.length > 0) {
    const locked = await db
      .select({ path: folderPasswordsTable.path })
      .from(folderPasswordsTable)
      .where(inArray(folderPasswordsTable.path, pageDirPaths));
    locked.forEach((r) => lockedPaths.add(r.path));
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
