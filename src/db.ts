import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureSqliteParent(dbPath: string): Promise<void> {
  if (dbPath === ":memory:") {
    return;
  }

  await mkdir(dirname(dbPath), { recursive: true });
}

export async function openSqlite(dbPath: string): Promise<Database> {
  await ensureSqliteParent(dbPath);
  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
