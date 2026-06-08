import { pool } from "../index";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS file_tokens (
    token      TEXT PRIMARY KEY,
    file_path  TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )
`;

export async function ensureFileTokensTable(): Promise<void> {
  await pool.query(CREATE_TABLE_SQL);
}

export async function createFileToken(
  token: string,
  filePath: string,
  expiresAt: Date,
): Promise<void> {
  await pool.query(
    "INSERT INTO file_tokens (token, file_path, expires_at) VALUES ($1, $2, $3)",
    [token, filePath, expiresAt],
  );
}

export async function getFileToken(
  token: string,
): Promise<{ filePath: string; expiresAt: Date } | null> {
  const result = await pool.query<{ file_path: string; expires_at: Date }>(
    "SELECT file_path, expires_at FROM file_tokens WHERE token = $1",
    [token],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { filePath: row.file_path, expiresAt: new Date(row.expires_at) };
}

export async function deleteFileToken(token: string): Promise<void> {
  await pool.query("DELETE FROM file_tokens WHERE token = $1", [token]);
}

export async function pruneExpiredFileTokens(): Promise<void> {
  await pool.query("DELETE FROM file_tokens WHERE expires_at < NOW()");
}
