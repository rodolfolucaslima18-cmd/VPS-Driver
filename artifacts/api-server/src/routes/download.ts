import { Router, type IRouter } from "express";
import path from "path";
import { createReadStream, existsSync } from "fs";

const router: IRouter = Router();

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

// GET /download/install.sh — serve o script de instalação
router.get("/download/install.sh", (req, res): void => {
  const scriptPath = path.join(workspaceRoot, "scripts", "install.sh");

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: "Script de instalação não encontrado." });
    return;
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="install.sh"');

  const stream = createReadStream(scriptPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro ao ler o script." });
    }
  });
  stream.pipe(res);
});

export default router;
