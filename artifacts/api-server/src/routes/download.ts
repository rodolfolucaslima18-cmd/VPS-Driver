import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const router: IRouter = Router();

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

// GET /download/install.sh — serve o script de instalação com repo URL injetada
router.get("/download/install.sh", async (req, res): Promise<void> => {
  const scriptPath = path.join(workspaceRoot, "scripts", "install.sh");

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: "Script de instalação não encontrado." });
    return;
  }

  // URL do repositório git a ser injetada no script.
  // Configurável via variável de ambiente VPS_DRIVE_REPO_URL.
  const repoUrl = process.env.VPS_DRIVE_REPO_URL ?? "";

  let content: string;
  try {
    content = await fs.readFile(scriptPath, "utf-8");
  } catch {
    res.status(500).json({ error: "Erro ao ler o script." });
    return;
  }

  // Injetar o placeholder __REPO_URL__ com a URL real
  content = content.replace("__REPO_URL__", repoUrl);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="install.sh"');
  res.send(content);
});

export default router;
