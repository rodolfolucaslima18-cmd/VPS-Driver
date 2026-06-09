/**
 * Standalone CLI reindex script.
 *
 * Clears the file_index table and re-walks STORAGE_ROOT, inserting every
 * file and directory found on disk.  Run once after first deploy or any
 * time you need to rebuild the index from scratch.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run reindex
 */
import { reindexAll } from "../lib/file-index.js";
import { pool } from "@workspace/db";

async function main() {
  console.log("[reindex] Starting full file index rebuild...");
  const start = Date.now();
  try {
    const { indexed } = await reindexAll();
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[reindex] Done. Indexed ${indexed} item(s) in ${elapsed}s.`);
    process.exitCode = 0;
  } catch (err) {
    console.error("[reindex] Failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
