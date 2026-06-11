import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";

const router: IRouter = Router();

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

// GET /download/install.sh — serve o script de instalação com URLs injetadas
router.get("/download/install.sh", async (req, res): Promise<void> => {
  const scriptPath = path.join(workspaceRoot, "scripts", "install.sh");

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: "Script de instalação não encontrado." });
    return;
  }

  const repoUrl = process.env.VPS_DRIVE_REPO_URL ?? "";
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const baseUrl = `${proto}://${req.get("host")}`;

  let content: string;
  try {
    content = await fs.readFile(scriptPath, "utf-8");
  } catch {
    res.status(500).json({ error: "Erro ao ler o script." });
    return;
  }

  content = content.replace("__REPO_URL__", repoUrl);
  content = content.replace("__INSTALLER_BASE_URL__", baseUrl);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="install.sh"');
  res.send(content);
});

// GET /download/update.sh — serve o script de atualização com URLs injetadas
router.get("/download/update.sh", async (req, res): Promise<void> => {
  const scriptPath = path.join(workspaceRoot, "scripts", "update.sh");

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: "Script de atualização não encontrado." });
    return;
  }

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const baseUrl = `${proto}://${req.get("host")}`;

  let content: string;
  try {
    content = await fs.readFile(scriptPath, "utf-8");
  } catch {
    res.status(500).json({ error: "Erro ao ler o script." });
    return;
  }

  content = content.replace("__INSTALLER_BASE_URL__", baseUrl);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="update.sh"');
  res.send(content);
});

// GET /download/install-onlyoffice.sh — serve o script de instalação standalone do OnlyOffice
router.get("/download/install-onlyoffice.sh", async (req, res): Promise<void> => {
  const scriptPath = path.join(workspaceRoot, "scripts", "install-onlyoffice.sh");

  if (!existsSync(scriptPath)) {
    res.status(404).json({ error: "Script não encontrado." });
    return;
  }

  let content: string;
  try {
    content = await fs.readFile(scriptPath, "utf-8");
  } catch {
    res.status(500).json({ error: "Erro ao ler o script." });
    return;
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="install-onlyoffice.sh"');
  res.send(content);
});

// GET /download/project.tar.gz — serve o código do projeto como tarball
router.get("/download/project.tar.gz", (_req, res): void => {
  const excludes = [
    "--exclude=./node_modules",
    "--exclude=./.git",
    "--exclude=./.cache",
    "--exclude=./.local",
    "--exclude=./storage",
    "--exclude=./artifacts/api-server/dist",
    "--exclude=./artifacts/vps-drive/dist",
    "--exclude=./artifacts/mockup-sandbox/dist",
    "--exclude=./attached_assets",
  ];

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", 'attachment; filename="project.tar.gz"');

  const tar = spawn("tar", ["czf", "-", ...excludes, "."], {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "ignore"],
  });

  tar.stdout.pipe(res);

  tar.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: `Erro ao gerar tarball: ${err.message}` });
    } else {
      res.destroy();
    }
  });

  tar.on("close", (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ error: "Falha ao criar tarball." });
    }
  });
});

export default router;
