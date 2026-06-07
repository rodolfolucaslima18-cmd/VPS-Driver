import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { randomUUID } from "crypto";

const router: IRouter = Router();

async function hasMasterUser(): Promise<boolean> {
  try {
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "master"))
      .limit(1);
    return !!user;
  } catch {
    return false;
  }
}

// GET /setup/status — público, verifica se setup já foi concluído
router.get("/setup/status", async (_req, res): Promise<void> => {
  const done = await hasMasterUser();
  res.json({ done });
});

// POST /setup/create-master — público, executável apenas uma vez
router.post("/setup/create-master", async (req, res): Promise<void> => {
  const masterExists = await hasMasterUser();
  if (masterExists) {
    res.status(403).json({ error: "Setup já foi concluído. Acesso negado." });
    return;
  }

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

    await db.insert(usersTable).values({
      id: randomUUID(),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: "master",
      isActive: true,
    });

    res.status(201).json({ ok: true, message: "Usuário Master criado com sucesso." });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === "23505") {
      res.status(400).json({ error: "Este e-mail já está em uso." });
    } else {
      console.error("Erro ao criar usuário Master:", err);
      res.status(500).json({ error: "Erro interno ao criar o usuário." });
    }
  }
});

export default router;
