import path from "path";
import app from "./app";
import { logger } from "./lib/logger";

// Load .env from the project root (works on VPS regardless of PM2 env injection)
try {
  const envPath = path.resolve(process.cwd(), ".env");
  process.loadEnvFile(envPath);
} catch {
  // .env not found or already loaded — not an error in production
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
