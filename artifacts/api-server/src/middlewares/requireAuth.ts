import type { Request, Response, NextFunction } from "express";

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  next();
};

export const requireMaster = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  if (req.session.role !== "master") {
    res.status(403).json({ error: "Acesso negado. Apenas o usuário Master pode acessar esta área." });
    return;
  }
  next();
};
