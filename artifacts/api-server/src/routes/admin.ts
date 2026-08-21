import { Router, type IRouter } from "express";
import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireMaster } from "../middlewares/requireAuth";
import { hashPassword } from "../lib/auth";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const router: IRouter = Router();

// In-memory update state for SSE streaming
interface UpdateRun {
  running: boolean;
  lines: string[];
  exitCode: number | null;
  emitter: EventEmitter;
  startedAt: number;
}

let currentUpdate: UpdateRun | null = null;
const DEFAULT_GITHUB_REPO_URL = "https://github.com/rodolfolucaslima18-cmd/VPS-Driver.git";
const DEFAULT_GITHUB_REPO_BRANCH = "main";

// GET /admin/users — listar todos os usuários
router.get("/admin/users", requireMaster, async (_req, res): Promise<void> => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(asc(usersTable.createdAt));

    res.json({ users, totalCount: users.length });
  } catch (err) {
    console.error("Erro ao listar usuários:", err);
    res.status(500).json({ error: "Erro ao buscar usuários." });
  }
});

// POST /admin/users — criar novo usuário
router.post("/admin/users", requireMaster, async (req, res): Promise<void> => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ error: "Nome, e-mail e senha são obrigatórios." });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "A senha deve ter pelo menos 8 caracteres." });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    res.status(400).json({ error: "E-mail inválido." });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const [newUser] = await db
      .insert(usersTable)
      .values({
        id: randomUUID(),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role: "user",
        isActive: true,
      })
      .returning({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      });

    res.status(201).json({ ok: true, message: "Usuário criado com sucesso.", user: newUser });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === "23505") {
      res.status(400).json({ error: "Este e-mail já está em uso." });
    } else {
      console.error("Erro ao criar usuário:", err);
      res.status(500).json({ error: "Erro ao criar usuário." });
    }
  }
});

// PATCH /admin/users/:userId/suspend — suspender ou reativar usuário
router.patch(
  "/admin/users/:userId/suspend",
  requireMaster,
  async (req, res): Promise<void> => {
    const targetId = String(req.params.userId);
    const currentUserId = req.session.userId!;

    if (targetId === currentUserId) {
      res.status(400).json({ error: "Você não pode suspender sua própria conta." });
      return;
    }

    try {
      const [user] = await db
        .select({ isActive: usersTable.isActive, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, targetId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "Usuário não encontrado." });
        return;
      }

      if (user.role === "master") {
        res.status(400).json({ error: "Não é possível suspender o usuário Master." });
        return;
      }

      const newStatus = !user.isActive;
      await db
        .update(usersTable)
        .set({ isActive: newStatus })
        .where(eq(usersTable.id, targetId));

      res.json({
        ok: true,
        message: newStatus ? "Usuário reativado com sucesso." : "Usuário suspenso com sucesso.",
        isActive: newStatus,
      });
    } catch (err) {
      console.error("Erro ao suspender/reativar usuário:", err);
      res.status(500).json({ error: "Erro ao alterar status do usuário." });
    }
  },
);

// DELETE /admin/users/:userId — remover usuário
router.delete(
  "/admin/users/:userId",
  requireMaster,
  async (req, res): Promise<void> => {
    const targetId = String(req.params.userId);
    const currentUserId = req.session.userId!;

    if (targetId === currentUserId) {
      res.status(400).json({ error: "Você não pode remover sua própria conta." });
      return;
    }

    try {
      const [user] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, targetId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "Usuário não encontrado." });
        return;
      }

      if (user.role === "master") {
        res.status(400).json({ error: "Não é possível remover o usuário Master." });
        return;
      }

      await db.delete(usersTable).where(eq(usersTable.id, targetId));
      res.json({ ok: true, message: "Usuário removido com sucesso." });
    } catch (err) {
      console.error("Erro ao remover usuário:", err);
      res.status(500).json({ error: "Erro ao remover usuário." });
    }
  },
);

// PATCH /admin/users/:userId/password — redefinir senha de um usuário
router.patch(
  "/admin/users/:userId/password",
  requireMaster,
  async (req, res): Promise<void> => {
    const targetId = String(req.params.userId);
    const { password } = req.body as { password?: string };

    if (!password || password.length < 8) {
      res.status(400).json({ error: "A nova senha deve ter pelo menos 8 caracteres." });
      return;
    }

    try {
      const [user] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, targetId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "Usuário não encontrado." });
        return;
      }

      const passwordHash = await hashPassword(password);
      await db
        .update(usersTable)
        .set({ passwordHash })
        .where(eq(usersTable.id, targetId));

      res.json({ ok: true, message: "Senha redefinida com sucesso." });
    } catch (err) {
      console.error("Erro ao redefinir senha:", err);
      res.status(500).json({ error: "Erro ao redefinir senha." });
    }
  },
);

// ── Helpers para manipulação do .env ─────────────────────────────────────────

function getInstallDir(): string {
  return process.env.VPS_DRIVE_DIR ?? path.resolve(process.cwd());
}

function getEnvFilePath(): string {
  return path.join(getInstallDir(), ".env");
}

function readEnvVar(key: string): string {
  const envPath = getEnvFilePath();
  if (!existsSync(envPath)) return process.env[key] ?? "";
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      return trimmed.slice(key.length + 1).replace(/^["']|["']$/g, "");
    }
  }
  return process.env[key] ?? "";
}

function writeEnvVar(key: string, value: string): void {
  const envPath = getEnvFilePath();
  let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    if (content.length > 0 && !content.endsWith("\n")) lines.push("");
    lines.push(newLine);
  }
  writeFileSync(envPath, lines.join("\n"));
  process.env[key] = value;
}

function normalizeGitHubRepoUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  const githubUrl = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;

  if (!githubUrl.test(trimmed)) return null;
  return trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
}

function normalizeGitBranch(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) return null;
  if (trimmed.startsWith("-") || trimmed.includes("..") || trimmed.includes("//")) return null;
  return trimmed;
}

function getUpdateRepoUrl(): string {
  return normalizeGitHubRepoUrl(readEnvVar("VPS_DRIVE_REPO_URL")) ?? DEFAULT_GITHUB_REPO_URL;
}

function getUpdateRepoBranch(): string {
  return normalizeGitBranch(readEnvVar("VPS_DRIVE_REPO_BRANCH")) ?? DEFAULT_GITHUB_REPO_BRANCH;
}

// GET /admin/settings — lê configurações editáveis (apenas master)
router.get("/admin/settings", requireMaster, (_req, res): void => {
  res.json({ repoUrl: getUpdateRepoUrl(), repoBranch: getUpdateRepoBranch() });
});

// PATCH /admin/settings — salva configurações editáveis (apenas master)
router.patch("/admin/settings", requireMaster, (req, res): void => {
  const { repoUrl, repoBranch } = req.body as { repoUrl?: string; repoBranch?: string };

  if (repoUrl === undefined && repoBranch === undefined) {
    res.status(400).json({ error: "Informe o repositório ou a branch de atualização." });
    return;
  }

  const nextRepoUrl = repoUrl === undefined ? getUpdateRepoUrl() : normalizeGitHubRepoUrl(repoUrl);
  const nextRepoBranch = repoBranch === undefined ? getUpdateRepoBranch() : normalizeGitBranch(repoBranch);

  if (!nextRepoUrl) {
    res.status(400).json({
      error: "Repositório inválido. Use uma URL do GitHub, como https://github.com/usuario/repositorio.git",
    });
    return;
  }

  if (!nextRepoBranch) {
    res.status(400).json({ error: "Branch inválida. Use, por exemplo, main." });
    return;
  }

  try {
    writeEnvVar("VPS_DRIVE_REPO_URL", nextRepoUrl);
    writeEnvVar("VPS_DRIVE_REPO_BRANCH", nextRepoBranch);
    res.json({ ok: true, repoUrl: nextRepoUrl, repoBranch: nextRepoBranch });
  } catch (err) {
    console.error("Erro ao salvar configuração:", err);
    res.status(500).json({ error: "Erro ao salvar configuração." });
  }
});

// Stable start-time token: computed once when this module loads, changes on every restart.
const SERVER_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

// GET /admin/version — versão atual do app
router.get("/admin/version", requireMaster, (_req, res): void => {
  try {
    const installDir = process.env.VPS_DRIVE_DIR ?? path.resolve(process.cwd());
    let version = "0.0.0";
    const pkgPath = path.join(installDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
      version = pkg.version ?? "0.0.0";
    }
    res.json({
      version,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: SERVER_STARTED_AT,
    });
  } catch {
    res.json({
      version: "0.0.0",
      nodeVersion: process.version,
      uptimeSeconds: 0,
      startedAt: SERVER_STARTED_AT,
    });
  }
});

// POST /admin/update — inicia atualização do app via update.sh (com log em tempo real via SSE)
router.post("/admin/update", requireMaster, (req, res): void => {
  try {
    const installDir = getInstallDir();
    const scriptPath = path.join(installDir, "scripts", "update.sh");

    if (!existsSync(scriptPath)) {
      res.status(400).json({ error: "Script de atualização não encontrado em " + scriptPath });
      return;
    }

    const repoUrl = getUpdateRepoUrl();
    const repoBranch = getUpdateRepoBranch();

    // If a previous update is still running, reject
    if (currentUpdate?.running) {
      res.status(409).json({ error: "Uma atualização já está em andamento." });
      return;
    }

    const run: UpdateRun = {
      running: true,
      lines: [],
      exitCode: null,
      emitter: new EventEmitter(),
      startedAt: Date.now(),
    };
    run.emitter.setMaxListeners(20);
    currentUpdate = run;

    const child = spawn("bash", [scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        VPS_DRIVE_REPO_URL: repoUrl,
        VPS_DRIVE_REPO_BRANCH: repoBranch,
      },
      cwd: installDir,
    });

    const pushLine = (line: string) => {
      run.lines.push(line);
      run.emitter.emit("line", line);
    };

    const handleStream = (stream: NodeJS.ReadableStream) => {
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buf += chunk;
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (part.length > 0) pushLine(part);
        }
      });
      stream.on("end", () => {
        if (buf.length > 0) { pushLine(buf); buf = ""; }
      });
    };

    if (child.stdout) handleStream(child.stdout);
    if (child.stderr) handleStream(child.stderr);

    child.on("exit", (code) => {
      run.running = false;
      run.exitCode = code ?? -1;
      run.emitter.emit("done", code ?? -1);
    });

    child.on("error", (err) => {
      pushLine(`[erro ao iniciar script: ${err.message}]`);
      run.running = false;
      run.exitCode = -1;
      run.emitter.emit("done", -1);
    });

    res.json({ ok: true, message: "Atualização iniciada." });
  } catch (err) {
    console.error("Erro ao iniciar atualização:", err);
    res.status(500).json({ error: "Erro ao iniciar atualização." });
  }
});

// GET /admin/update-stream — SSE stream do log da atualização em andamento
router.get("/admin/update-stream", requireMaster, (req, res): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const run = currentUpdate;
  if (!run) {
    send("error", "Nenhuma atualização em andamento.");
    res.end();
    return;
  }

  // Replay buffered lines
  for (const line of run.lines) {
    send("line", line);
  }

  if (!run.running) {
    send("done", run.exitCode === 0 ? "success" : "error");
    res.end();
    return;
  }

  const onLine = (line: string) => send("line", line);
  const onDone = (code: number) => {
    send("done", code === 0 ? "success" : "error");
    res.end();
  };

  run.emitter.on("line", onLine);
  run.emitter.once("done", onDone);

  req.on("close", () => {
    run.emitter.off("line", onLine);
    run.emitter.off("done", onDone);
  });
});

export default router;
