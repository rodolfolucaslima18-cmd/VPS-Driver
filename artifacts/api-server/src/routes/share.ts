import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { getAuth } from "@clerk/express";
import { resolveStoragePath, getMimeType } from "../lib/storage";
import {
  createShareToken,
  getShareToken,
  deleteShareToken,
  listShareTokensByUser,
} from "../lib/shares";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const TTL_MAP: Record<string, number> = {
  "1h": 3600,
  "24h": 86400,
  "7d": 604800,
};

// POST /share — create a share token (requires auth)
router.post("/share", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }

  const { path: filePath, ttl } = req.body as { path?: string; ttl?: string };

  if (!filePath) {
    res.status(400).json({ error: "path é obrigatório." });
    return;
  }

  const ttlSeconds = TTL_MAP[ttl ?? "24h"] ?? TTL_MAP["24h"];

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

  const token = await createShareToken(filePath, ttlSeconds, userId);
  res.status(201).json(token);
});

// GET /share/list — list active share tokens for current user (requires auth)
router.get("/share/list", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  const tokens = await listShareTokensByUser(userId);
  res.json(tokens);
});

// GET /share/:token — serve the file publicly (no auth required)
router.get("/share/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const entry = await getShareToken(token);

  if (!entry) {
    res.status(404).json({ error: "Link inválido ou expirado." });
    return;
  }

  let absPath: string;
  try {
    absPath = resolveStoragePath(entry.filePath);
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
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }

  const { token } = req.params;
  const entry = await getShareToken(token);

  if (!entry) {
    res.status(404).json({ error: "Token não encontrado." });
    return;
  }

  if (entry.createdBy !== userId) {
    res.status(403).json({ error: "Sem permissão para revogar este link." });
    return;
  }

  await deleteShareToken(token);
  res.sendStatus(204);
});

export default router;
