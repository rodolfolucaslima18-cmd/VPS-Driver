import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const router: IRouter = Router();

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

// GET /download/install.sh — serve o script de instalação
router.get("/download/install.sh", async (_req, res): Promise<void> => {
  const scriptPath = path.join(workspaceRoot, "scripts", "install.sh");

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: "Script de instalação não encontrado." });
    return;
  }

  try {
    const content = await fs.readFile(scriptPath, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="install.sh"');
    res.send(content);
  } catch {
    res.status(500).json({ error: "Erro ao ler o script." });
  }
});

// GET /download/update.sh — serve o script de atualização
router.get("/download/update.sh", async (_req, res): Promise<void> => {
  const scriptPath = path.join(workspaceRoot, "scripts", "update.sh");

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: "Script de atualização não encontrado." });
    return;
  }

  try {
    const content = await fs.readFile(scriptPath, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="update.sh"');
    res.send(content);
  } catch {
    res.status(500).json({ error: "Erro ao ler o script." });
  }
});

export default router;
