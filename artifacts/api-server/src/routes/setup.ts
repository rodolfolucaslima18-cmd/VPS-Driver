import { Router, type IRouter } from "express";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { createClerkClient } from "@clerk/backend";
import { STORAGE_ROOT } from "../lib/storage";

const router: IRouter = Router();

const SETUP_MARKER = path.join(STORAGE_ROOT, ".setup_done");

function getClerk() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY não configurada");
  }
  return createClerkClient({ secretKey });
}

async function hasExistingUsers(): Promise<boolean> {
  try {
    const clerk = getClerk();
    const result = await clerk.users.getUserList({ limit: 1 });
    return result.totalCount > 0;
  } catch {
    return false;
  }
}

// GET /setup/status — público, verifica se setup já foi concluído
router.get("/setup/status", async (_req, res): Promise<void> => {
  const markerExists = existsSync(SETUP_MARKER);
  if (markerExists) {
    res.json({ done: true });
    return;
  }
  const usersExist = await hasExistingUsers();
  res.json({ done: usersExist });
});

// POST /setup/create-master — público, executável apenas uma vez
router.post("/setup/create-master", async (req, res): Promise<void> => {
  if (existsSync(SETUP_MARKER)) {
    res.status(403).json({ error: "Setup já foi concluído. Acesso negado." });
    return;
  }

  const usersExist = await hasExistingUsers();
  if (usersExist) {
    res.status(403).json({ error: "Já existe um usuário cadastrado. Setup bloqueado." });
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
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "E-mail inválido." });
    return;
  }

  try {
    const clerk = getClerk();

    const [firstName, ...rest] = name.trim().split(" ");
    const lastName = rest.join(" ") || undefined;

    await clerk.users.createUser({
      emailAddress: [email],
      password,
      firstName,
      lastName,
    });

    await fs.mkdir(STORAGE_ROOT, { recursive: true });
    await fs.writeFile(SETUP_MARKER, new Date().toISOString(), "utf-8");

    res.status(201).json({ ok: true, message: "Usuário Master criado com sucesso." });
  } catch (err: unknown) {
    const clerkErr = err as { errors?: { message: string }[]; status?: number };
    if (clerkErr?.errors?.length) {
      const msg = clerkErr.errors[0].message;
      if (msg.toLowerCase().includes("email") || msg.toLowerCase().includes("e-mail")) {
        res.status(400).json({ error: "Este e-mail já está em uso." });
      } else {
        res.status(400).json({ error: msg });
      }
    } else {
      console.error("Erro ao criar usuário Master:", err);
      res.status(500).json({ error: "Erro interno ao criar o usuário. Verifique as chaves do Clerk." });
    }
  }
});

export default router;
