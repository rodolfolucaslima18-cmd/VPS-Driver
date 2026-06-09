import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { resolveStoragePath, getMimeType } from "../lib/storage";
import {
  createShareToken,
  getShareTokenRaw,
  deleteShareToken,
  listShareTokensByUser,
  incrementDownloadCount,
} from "../lib/shares";
import { hashPassword, verifyPassword } from "../lib/auth";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// POST /share — create a share token (requires auth)
router.post("/share", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const {
    path: filePath,
    expiresIn,
    password,
    maxDownloads,
  } = req.body as {
    path?: string;
    expiresIn?: number | null;
    password?: string;
    maxDownloads?: number | null;
  };

  if (!filePath) {
    res.status(400).json({ error: "path é obrigatório." });
    return;
  }

  // expiresIn = seconds (null = never)
  const ttlSeconds: number | null = expiresIn ?? null;

  let absPath: string;
  try {
    absPath = resolveStoragePath(filePath);
  } catch {
    res.status(400).json({ error: "Caminho inválido." });
    return;
  }

  if (!existsSync(absPath)) {
    res.status(404).json({ error: "Arquivo não encontrado." });
    return;
  }

  const stats = await fs.stat(absPath);
  if (stats.isDirectory()) {
    res.status(400).json({ error: "Não é possível compartilhar uma pasta." });
    return;
  }

  const passwordHash = password ? await hashPassword(password) : null;
  const maxDl = typeof maxDownloads === "number" && maxDownloads > 0 ? maxDownloads : null;

  const token = await createShareToken(filePath, ttlSeconds, userId, passwordHash, maxDl);
  res.status(201).json(token);
});

// GET /share/list — list active share tokens for current user (requires auth)
router.get("/share/list", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const tokens = await listShareTokensByUser(userId);
  res.json(tokens);
});

// GET /share/:token/info — public: return metadata for a share link
router.get("/share/:token/info", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const row = await getShareTokenRaw(token);

  if (!row) {
    res.json({ found: false });
    return;
  }

  const now = new Date();
  const isExpired = row.expiresAt ? row.expiresAt < now : false;
  const isLimitReached = row.maxDownloads !== null && row.downloadCount >= row.maxDownloads;
  const fileName = path.basename(row.filePath);

  res.json({
    found: true,
    fileName,
    isExpired,
    isLimitReached,
    requiresPassword: !!row.passwordHash,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    downloadCount: row.downloadCount,
    maxDownloads: row.maxDownloads,
  });
});

// POST /share/:token/unlock — validate password for a protected share link
router.post("/share/:token/unlock", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const { password } = req.body as { password?: string };

  if (!password) {
    res.status(400).json({ error: "Senha obrigatória." });
    return;
  }

  const row = await getShareTokenRaw(token);
  if (!row) {
    res.status(404).json({ error: "Link inválido ou expirado." });
    return;
  }

  const now = new Date();
  if (row.expiresAt && row.expiresAt < now) {
    res.status(410).json({ error: "Link expirado." });
    return;
  }

  if (!row.passwordHash) {
    res.status(400).json({ error: "Este link não tem senha." });
    return;
  }

  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Senha incorreta." });
    return;
  }

  if (!req.session.unlockedShares) req.session.unlockedShares = [];
  if (!req.session.unlockedShares.includes(token)) {
    req.session.unlockedShares.push(token);
  }
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );

  res.json({ ok: true });
});

// GET /share/:token — serve the file publicly (no auth required)
router.get("/share/:token", async (req, res): Promise<void> => {
  const token = req.params.token as string;
  const row = await getShareTokenRaw(token);

  if (!row) {
    res.status(404).json({ error: "Link inválido ou expirado." });
    return;
  }

  const now = new Date();
  if (row.expiresAt && row.expiresAt < now) {
    res.status(410).json({ error: "EXPIRED", message: "Este link expirou." });
    return;
  }

  if (row.maxDownloads !== null && row.downloadCount >= row.maxDownloads) {
    res.status(429).json({ error: "LIMIT_REACHED", message: "Limite de downloads atingido." });
    return;
  }

  if (row.passwordHash) {
    const unlocked = req.session?.unlockedShares ?? [];
    if (!unlocked.includes(token)) {
      res.status(401).json({ error: "PASSWORD_REQUIRED" });
      return;
    }
  }

  let absPath: string;
  try {
    absPath = resolveStoragePath(row.filePath);
  } catch {
    res.status(400).json({ error: "Caminho inválido." });
    return;
  }

  if (!existsSync(absPath)) {
    res.status(404).json({ error: "Arquivo não encontrado." });
    return;
  }

  let stats: import("fs").Stats;
  try {
    stats = await fs.stat(absPath);
  } catch {
    res.status(500).json({ error: "Erro ao acessar arquivo." });
    return;
  }

  const filename = path.basename(absPath);
  const mimeType = getMimeType(absPath);
  const inline = req.query.inline === "1";

  res.setHeader("Content-Type", mimeType);
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${filename}"`
  );
  res.setHeader("Content-Length", stats.size);

  incrementDownloadCount(token).catch(() => {});

  const stream = createReadStream(absPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro ao ler arquivo." });
    }
  });
  stream.pipe(res);
});

// DELETE /share/:token — revoke a share token (requires auth)
router.delete("/share/:token", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const token = req.params.token as string;
  const row = await getShareTokenRaw(token);

  if (!row) {
    res.status(404).json({ error: "Token não encontrado." });
    return;
  }

  if (row.createdBy !== userId) {
    res.status(403).json({ error: "Sem permissão para revogar este link." });
    return;
  }

  await deleteShareToken(token);
  res.sendStatus(204);
});

export default router;
