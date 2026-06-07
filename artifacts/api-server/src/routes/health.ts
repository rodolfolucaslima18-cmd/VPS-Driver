import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// GET /healthz/db — verifies live DB connectivity; returns 503 if unreachable.
// Error details are logged server-side only; the external response is generic.
router.get("/healthz/db", async (_req, res): Promise<void> => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    // Log full details internally; do not expose internal error messages to callers
    console.error("DB health check failed:", err);
    res.status(503).json({ status: "error", db: "unreachable" });
  }
});

export default router;
