import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireMaster } from "../middlewares/requireAuth";
import { hashPassword } from "../lib/auth";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

const router: IRouter = Router();

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInstallDir(): string {
  return process.env.VPS_DRIVE_DIR ?? path.resolve(process.cwd());
}

// Stable start-time token: computed once when this module loads, changes on every restart.
const SERVER_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

// GET /admin/version — versão atual do app
router.get("/admin/version", requireMaster, (_req, res): void => {
  try {
    const installDir = getInstallDir();
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

// POST /admin/update — inicia atualização do app via update.sh (puxa do GitHub)
router.post("/admin/update", requireMaster, (_req, res): void => {
  try {
    const installDir = getInstallDir();
    const scriptPath = path.join(installDir, "scripts", "update.sh");

    if (!existsSync(scriptPath)) {
      res.status(400).json({ error: "Script de atualização não encontrado em " + scriptPath });
      return;
    }

    const child = spawn("bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
      cwd: installDir,
    });
    child.unref();

    res.json({ ok: true, message: "Atualização iniciada. O servidor será reiniciado em instantes." });
  } catch (err) {
    console.error("Erro ao iniciar atualização:", err);
    res.status(500).json({ error: "Erro ao iniciar atualização." });
  }
});

export default router;
