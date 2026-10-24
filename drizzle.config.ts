import { defineConfig } from "drizzle-kit";

// drizzle/ is archived SQLite history; PostgreSQL uses a distinct journal.
export default defineConfig({
  out: "./migrations/postgres",
  schema: "./db/schema.ts",
  dialect: "postgresql",
});
