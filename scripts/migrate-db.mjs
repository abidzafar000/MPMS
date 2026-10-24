import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
const migrationsFolder = new URL("../migrations/postgres/", import.meta.url);

// Deployment-only schema work. Application requests never create tables.
// One transaction plus an advisory lock makes repeated/concurrent invocations
// safe. Previously applied files are immutable and verified by SHA-256.
export async function migrateDatabase(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const files = (await readdir(migrationsFolder)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  if (!files.length) throw new Error("No PostgreSQL migrations were found.");
  const migrations = await Promise.all(files.map(async id => {
    // Git may check out CRLF on Windows and LF on the deployment host. Hash
    // canonical line endings so the same committed SQL has the same checksum.
    const source = (await readFile(new URL(id, migrationsFolder), "utf8")).replace(/\r\n/g, "\n");
    return { id, source, checksum: createHash("sha256").update(source).digest("hex") };
  }));
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000 });
  pool.on("error", () => console.error("Migration database connection failed."));
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mpms-schema-migrations', 0))");
    await client.query("CREATE TABLE IF NOT EXISTS mpms_schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT id, checksum FROM mpms_schema_migrations ORDER BY id");
    const known = new Map(migrations.map(migration => [migration.id, migration]));
    for (const row of applied.rows) {
      if (!known.has(row.id)) throw new Error("The database contains a migration absent from this checkout.");
      if (known.get(row.id).checksum !== row.checksum) throw new Error("An applied migration checksum has changed.");
    }
    const appliedIds = new Set(applied.rows.map(row => row.id));
    let count = 0;
    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) continue;
      if (applied.rows.some(row => row.id > migration.id)) throw new Error("A migration was inserted before previously applied history.");
      await client.query(migration.source);
      await client.query("INSERT INTO mpms_schema_migrations (id, checksum) VALUES ($1, $2)", [migration.id, migration.checksum]);
      count++;
    }
    await client.query("COMMIT");
    return count;
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--apply") throw new Error("Use node scripts/migrate-db.mjs --apply.");
    if (!process.env.DATABASE_URL) process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
    const count = await migrateDatabase(process.env.DATABASE_URL);
    console.log(`Applied ${count} PostgreSQL migration(s).`);
  } catch (error) {
    // Driver error text may include connection details: never echo it or URLs.
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? ` (${error.code})` : "";
    console.error(`Database migration failed${code}. Check migration history and database configuration.`);
    process.exitCode = 1;
  }
}
