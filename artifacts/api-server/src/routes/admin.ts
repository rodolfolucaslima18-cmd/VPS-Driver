import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { createClerkClient } from "@clerk/backend";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

function getClerk() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY não configurada");
  return createClerkClient({ secretKey });
}

async function requireMaster(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;

  if (!userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }

  try {
    const clerk = getClerk();
    const { data: users } = await clerk.users.getUserList({
      limit: 1,
      orderBy: "+created_at",
    });

    if (!users.length || users[0].id !== userId) {
      res
        .status(403)
        .json({ error: "Acesso negado. Apenas o usuário Master pode acessar esta área." });
      return;
    }

    next();
  } catch (err) {
    console.error("Erro ao verificar usuário Master:", err);
    res.status(500).json({ error: "Erro interno ao verificar permissões." });
  }
}

// GET /admin/me — verifica se o usuário atual é o Master
router.get("/admin/me", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;

  if (!userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }

  try {
    const clerk = getClerk();
    const { data: users } = await clerk.users.getUserList({
      limit: 1,
      orderBy: "+created_at",
    });

    const isMaster = users.length > 0 && users[0].id === userId;
    res.json({ isMaster });
  } catch (err) {
    console.error("Erro ao verificar usuário Master:", err);
    res.status(500).json({ error: "Erro interno ao verificar permissões." });
  }
});

// GET /admin/users — listar todos os usuários
router.get("/admin/users", requireMaster, async (_req, res): Promise<void> => {
  try {
    const clerk = getClerk();
    const { data: users, totalCount } = await clerk.users.getUserList({
      limit: 500,
      orderBy: "+created_at",
    });

    res.json({
      users: users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.emailAddresses[0]?.emailAddress ?? null,
        createdAt: u.createdAt,
        banned: u.banned,
        lastSignInAt: u.lastSignInAt,
      })),
      totalCount,
    });
  } catch (err) {
    console.error("Erro ao listar usuários:", err);
    res.status(500).json({ error: "Erro ao buscar usuários." });
  }
});

// POST /admin/users/invite — convidar novo usuário por e-mail
router.post("/admin/users/invite", requireMaster, async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ error: "E-mail é obrigatório." });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    res.status(400).json({ error: "E-mail inválido." });
    return;
  }

  try {
    const clerk = getClerk();
    await clerk.invitations.createInvitation({ emailAddress: email.trim() });
    res.json({ ok: true, message: `Convite enviado para ${email.trim()}.` });
  } catch (err: unknown) {
    const clerkErr = err as { errors?: { message: string }[]; status?: number };
    if (clerkErr?.errors?.length) {
      res.status(400).json({ error: clerkErr.errors[0].message });
    } else {
      console.error("Erro ao convidar usuário:", err);
      res.status(500).json({ error: "Erro ao enviar convite." });
    }
  }
});

// PATCH /admin/users/:userId/suspend — suspender ou reativar usuário
router.patch(
  "/admin/users/:userId/suspend",
  requireMaster,
  async (req, res): Promise<void> => {
    const userId = String(req.params.userId);
    const auth = getAuth(req);
    const currentUserId = auth?.sessionClaims?.userId || auth?.userId;

    if (userId === currentUserId) {
      res.status(400).json({ error: "Você não pode suspender sua própria conta." });
      return;
    }

    try {
      const clerk = getClerk();
      const user = await clerk.users.getUser(userId);

      if (user.banned) {
        await clerk.users.unbanUser(userId);
        res.json({ ok: true, message: "Usuário reativado com sucesso.", banned: false });
      } else {
        await clerk.users.banUser(userId);
        res.json({ ok: true, message: "Usuário suspenso com sucesso.", banned: true });
      }
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
    const userId = String(req.params.userId);
    const auth = getAuth(req);
    const currentUserId = auth?.sessionClaims?.userId || auth?.userId;

    if (userId === currentUserId) {
      res.status(400).json({ error: "Você não pode remover sua própria conta." });
      return;
    }

    try {
      const clerk = getClerk();
      await clerk.users.deleteUser(userId);
      res.json({ ok: true, message: "Usuário removido com sucesso." });
    } catch (err) {
      console.error("Erro ao remover usuário:", err);
      res.status(500).json({ error: "Erro ao remover usuário." });
    }
  },
);

export default router;
