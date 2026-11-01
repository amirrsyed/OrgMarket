import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import { DDL } from "./ddl";

/**
 * DATABASE_URL set → real Postgres (Neon in production).
 * Otherwise → embedded PGlite persisted to .data/pglite: zero-setup local dev.
 * The two drivers expose an identical Drizzle API; we type against PGlite and
 * cast the postgres-js instance (runtime-compatible for everything we use).
 */
export type Db = PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __omDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__omDb ??= initDb().catch((err) => {
    // Never cache a failed init — let the next request retry.
    globalForDb.__omDb = undefined;
    throw err;
  });
  return globalForDb.__omDb;
}

async function initDb(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, { max: 10 });
    const db = drizzlePostgres(client, { schema }) as unknown as Db;
    await applyDdl(db);
    if (process.env.SEED_DEMO === "1") {
      const { seedIfEmpty } = await import("./seed");
      await seedIfEmpty(db);
    }
    return db;
  }
  const dataDir = process.env.PGLITE_DIR ?? ".data/pglite";
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  const db = drizzlePglite(pglite, { schema });
  await applyDdl(db);
  const { seedIfEmpty } = await import("./seed");
  await seedIfEmpty(db);
  return db;
}

export async function applyDdl(db: Db): Promise<void> {
  for (const stmt of DDL) await db.execute(sql.raw(stmt));
}

/** Fresh in-memory database for tests. */
export async function createTestDb(): Promise<Db> {
  const db = drizzlePglite(new PGlite(), { schema });
  await applyDdl(db);
  return db;
}
