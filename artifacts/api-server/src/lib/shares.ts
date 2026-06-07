import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import crypto from "crypto";
import { STORAGE_ROOT } from "./storage";

const SHARES_FILE = path.join(STORAGE_ROOT, ".shares.json");

export type ShareToken = {
  token: string;
  filePath: string;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
};

type ShareStore = Record<string, ShareToken>;

async function readStore(): Promise<ShareStore> {
  if (!existsSync(SHARES_FILE)) return {};
  try {
    const raw = await fs.readFile(SHARES_FILE, "utf-8");
    return JSON.parse(raw) as ShareStore;
  } catch {
    return {};
  }
}

async function writeStore(store: ShareStore): Promise<void> {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  await fs.writeFile(SHARES_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export async function createShareToken(
  filePath: string,
  ttlSeconds: number,
  createdBy: string
): Promise<ShareToken> {
  const store = await readStore();
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const entry: ShareToken = {
    token,
    filePath,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdBy,
  };
  store[token] = entry;
  await writeStore(store);
  return entry;
}

export async function getShareToken(token: string): Promise<ShareToken | null> {
  const store = await readStore();
  const entry = store[token];
  if (!entry) return null;
  if (new Date(entry.expiresAt) < new Date()) {
    delete store[token];
    await writeStore(store);
    return null;
  }
  return entry;
}

export async function deleteShareToken(token: string): Promise<boolean> {
  const store = await readStore();
  if (!store[token]) return false;
  delete store[token];
  await writeStore(store);
  return true;
}

export async function listShareTokensByUser(userId: string): Promise<ShareToken[]> {
  const store = await readStore();
  const now = new Date();
  return Object.values(store).filter(
    (t) => t.createdBy === userId && new Date(t.expiresAt) > now
  );
}
