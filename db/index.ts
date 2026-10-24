import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

// Lazy and request-scoped: builds need no credentials, and serverless requests
// close their WebSocket connections before finishing.
export function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for property storage.");
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 5_000 });
  pool.on("error", () => console.error("PMS database connection failed."));
  return drizzle(pool, { schema });
}

export type PmsDatabase = ReturnType<typeof getDb>;

export async function withDb<T>(operation: (db: PmsDatabase) => Promise<T>): Promise<T> {
  const db = getDb();
  try { return await operation(db); }
  finally { await db.$client.end(); }
}
