import crypto from "crypto";
import { db, shareTokensTable } from "@workspace/db";
import { eq, and, or, gt, isNull, sql } from "drizzle-orm";
import type { ShareTokenRow } from "@workspace/db";

export type ShareToken = {
  token: string;
  filePath: string;
  createdAt: string;
  expiresAt: string | null;
  createdBy: string;
  hasPassword: boolean;
  maxDownloads: number | null;
  downloadCount: number;
};

function rowToShareToken(row: ShareTokenRow): ShareToken {
  return {
    token: row.token,
    filePath: row.filePath,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    hasPassword: !!row.passwordHash,
    maxDownloads: row.maxDownloads,
    downloadCount: row.downloadCount,
  };
}

export async function createShareToken(
  filePath: string,
  expiresIn: number | null,
  createdBy: string,
  passwordHash?: string | null,
  maxDownloads?: number | null,
): Promise<ShareToken> {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 1000) : null;

  const [row] = await db.insert(shareTokensTable).values({
    token,
    filePath,
    createdAt: now,
    expiresAt,
    createdBy,
    passwordHash: passwordHash ?? null,
    maxDownloads: maxDownloads ?? null,
    downloadCount: 0,
  }).returning();

  return rowToShareToken(row);
}

export async function getShareTokenRaw(token: string): Promise<ShareTokenRow | null> {
  const [row] = await db
    .select()
    .from(shareTokensTable)
    .where(eq(shareTokensTable.token, token))
    .limit(1);
  return row ?? null;
}

export async function deleteShareToken(token: string): Promise<boolean> {
  const result = await db
    .delete(shareTokensTable)
    .where(eq(shareTokensTable.token, token));
  return (result.rowCount ?? 0) > 0;
}

export async function incrementDownloadCount(token: string): Promise<void> {
  await db
    .update(shareTokensTable)
    .set({ downloadCount: sql`${shareTokensTable.downloadCount} + 1` })
    .where(eq(shareTokensTable.token, token));
}

export async function listShareTokensByUser(userId: string): Promise<ShareToken[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(shareTokensTable)
    .where(
      and(
        eq(shareTokensTable.createdBy, userId),
        or(isNull(shareTokensTable.expiresAt), gt(shareTokensTable.expiresAt, now))
      )
    );
  return rows.map(rowToShareToken);
}
