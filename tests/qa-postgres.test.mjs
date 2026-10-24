import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Deliberately excluded from ordinary offline tests. Supply a DEVELOPMENT URL
// explicitly; never derive this target from the application's production URL.
const enabled = process.env.PMS_POSTGRES_TEST === "development";
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const externalImports = source => source.replace(/from (["'])([^.][^"']*)\1/g, (_, quote, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
async function loadModule(file, replacements = {}) {
  let source = compile(await readFile(new URL(file, import.meta.url), "utf8"));
  for (const [name, target] of Object.entries(replacements)) {
    source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`).replaceAll(`from '${name}'`, `from ${JSON.stringify(target)}`);
  }
  return moduleUrl(externalImports(source));
}

test("real development PostgreSQL transactions and property isolation", { skip: !enabled, timeout: 180_000 }, async t => {
  assert.ok(process.env.NODE_ENV !== "production" && !["production", "preview"].includes(process.env.VERCEL_ENV), "Database tests may run only in a local development environment.");
  const connectionString = process.env.PMS_POSTGRES_TEST_URL;
  assert.ok(connectionString && /^postgres(?:ql)?:\/\//.test(connectionString), "Set PMS_POSTGRES_TEST_URL to the dedicated development database.");
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = connectionString;
  const { migrateDatabase } = await import("../scripts/migrate-db.mjs");
  await migrateDatabase(connectionString);

  const typesUrl = await loadModule("../lib/pms-types.ts");
  const engineUrl = await loadModule("../lib/pms-engine.ts", { "./pms-types": typesUrl });
  const schemaUrl = await loadModule("../db/schema.ts");
  const dbUrl = await loadModule("../db/index.ts", { "./schema": schemaUrl });
  const serverUrl = await loadModule("../lib/server-pms.ts", { "../db": dbUrl, "../db/schema": schemaUrl, "./pms-engine": engineUrl });
  const { createProperty, readPms, mutatePms } = await import(serverUrl);
  const { getDb } = await import(dbUrl);
  const { createInitialState, applyPmsAction } = await import(engineUrl);
  const db = getDb(); const pool = db.$client;
  const owners = [];
  function actor(label) {
    const nonce = randomUUID();
    const value = { userId: `pg-qa-${nonce}`, email: `${label}-${nonce}@example.invalid`, name: `Postgres QA ${label}` };
    owners.push(value.userId); return value;
  }
  async function rawProperty(id) {
    const result = await pool.query("SELECT * FROM pms_properties WHERE id = $1", [id]);
    return result.rows[0];
  }
  async function replaceFixtureState(id, state) {
    await pool.query("UPDATE pms_properties SET state_json = $1 WHERE id = $2", [JSON.stringify(state), id]);
  }
  const rejectsStatus = status => error => { assert.equal(error.status, status); return true; };
  try {
    await t.test("migration is idempotent and state is stored as exact TEXT", async () => {
      assert.equal(await migrateDatabase(connectionString), 0);
      const type = await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pms_properties' AND column_name = 'state_json'");
      assert.equal(type.rows[0]?.data_type, "text");
      const owner = actor("serialization"); const result = await createProperty(owner, { name: "اردو QA Guesthouse" });
      const row = await rawProperty(result.state.property.id);
      assert.equal(row.state_json, JSON.stringify(result.state));
      const index = await pool.query("SELECT user_id, role FROM pms_memberships WHERE property_id = $1", [row.id]);
      assert.deepEqual(index.rows, [{ user_id: owner.userId, role: "owner" }]);
    });

    await t.test("concurrent bookings and receipts each commit once with a controlled conflict", async () => {
      const owner = actor("concurrency"); const created = await createProperty(owner, { name: "Concurrent QA" }); const id = created.state.property.id;
      let fixture = applyPmsAction(created.state, "saveRoomType", { name: "Double" }, owner);
      fixture = applyPmsAction(fixture, "saveRoom", { number: "101", typeId: fixture.roomTypes[0].id }, owner);
      fixture = applyPmsAction(fixture, "openShift", { openingPaisa: 0 }, owner);
      await replaceFixtureState(id, fixture);
      const booking = name => ({ guest: { name, phone: "", document: "", notes: "" }, roomId: fixture.rooms[0].id, arrival: "2030-01-10", departure: "2030-01-12", roomTotalPaisa: 100_000 });
      const outcomes = await Promise.allSettled([
        mutatePms(owner, id, 0, "createReservation", booking("First concurrent guest")),
        mutatePms(owner, id, 0, "createReservation", booking("Second concurrent guest")),
      ]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      const failed = outcomes.find(result => result.status === "rejected");
      assert.equal(failed.reason.status, 409); assert.equal(failed.reason.currentVersion, 1);
      const row = await rawProperty(id); const state = JSON.parse(row.state_json);
      assert.equal(row.version, 1); assert.equal(state.guests.length, 1); assert.equal(state.reservations.length, 1);
      assert.equal(state.audit.filter(event => event.action === "createReservation").length, 1);
      const receipts = await Promise.allSettled([
        mutatePms(owner, id, 1, "recordPayment", { reservationId: state.reservations[0].id, amountPaisa: 10_000, method: "bank" }),
        mutatePms(owner, id, 1, "recordPayment", { reservationId: state.reservations[0].id, amountPaisa: 10_000, method: "bank" }),
      ]);
      assert.equal(receipts.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(receipts.find(result => result.status === "rejected").reason.status, 409);
      const final = await rawProperty(id); const finalState = JSON.parse(final.state_json);
      assert.equal(final.version, 2); assert.equal(finalState.transactions.length, 1);
      assert.equal(finalState.transactions[0].amountPaisa, 10_000);
      assert.ok(finalState.transactions[0].receipt);
      const index = await pool.query("SELECT count(*)::int AS count FROM pms_memberships WHERE property_id = $1", [id]);
      assert.equal(index.rows[0].count, 1);
    });

    await t.test("membership projection failure rolls back aggregate, version and deletion", async () => {
      const owner = actor("rollback"); const created = await createProperty(owner, { name: "Rollback QA" }); const id = created.state.property.id;
      const corrupted = structuredClone(created.state);
      // Deliberately corrupt a fixture's projection source: the unique staff
      // constraint fails after the aggregate UPDATE and index DELETE execute.
      corrupted.staff.push({ ...corrupted.staff[0], email: `duplicate-${randomUUID()}@example.invalid` });
      await replaceFixtureState(id, corrupted);
      const before = await rawProperty(id);
      const beforeIndex = await pool.query("SELECT * FROM pms_memberships WHERE property_id = $1 ORDER BY id", [id]);
      await assert.rejects(mutatePms(owner, id, 0, "saveSettings", { name: "Must roll back" }));
      assert.deepEqual(await rawProperty(id), before);
      const afterIndex = await pool.query("SELECT * FROM pms_memberships WHERE property_id = $1 ORDER BY id", [id]);
      assert.deepEqual(afterIndex.rows, beforeIndex.rows);
    });

    await t.test("tenant reads/writes and low-permission guest fields remain isolated", async () => {
      const owner = actor("tenant"); const outsider = actor("outsider");
      const created = await createProperty(owner, { name: "Private QA" }); const id = created.state.property.id;
      const guest = await mutatePms(owner, id, 0, "saveGuest", { name: "Operational guest", phone: "03000000000", document: "private-document", notes: "private-notes" });
      const staff = actor("limited");
      const invited = await mutatePms(owner, id, guest.version, "saveStaff", { email: staff.email, name: staff.name, role: "reception", permissions: ["bookings"] });
      const view = await readPms(staff, id);
      assert.equal(view.state.guests[0].name, "Operational guest");
      assert.equal(view.state.guests[0].phone, "03000000000");
      assert.equal(view.state.guests[0].document, ""); assert.equal(view.state.guests[0].notes, "");
      // Even an incorrect discovery index must never confer property access.
      const staleId = randomUUID();
      await pool.query("INSERT INTO pms_memberships (id, property_id, staff_id, email, user_id, role, active) VALUES ($1,$2,$3,$4,$5,'owner',true)", [`${id}:${staleId}`, id, staleId, outsider.email, outsider.userId]);
      assert.equal((await readPms(outsider)).properties.length, 0);
      await assert.rejects(readPms(outsider, id), rejectsStatus(403));
      await assert.rejects(mutatePms(outsider, id, invited.version, "saveGuest", { name: "Forbidden" }), rejectsStatus(403));
      await assert.rejects(mutatePms(staff, id, invited.version, "saveSettings", { name: "Forbidden" }), rejectsStatus(403));
    });

    await t.test("revoked staff waiting on a property lock cannot mutate stale permissions", async () => {
      const owner = actor("revocation"); const staff = actor("revoked");
      const created = await createProperty(owner, { name: "Revocation QA" }); const id = created.state.property.id;
      const invited = await mutatePms(owner, id, 0, "saveStaff", { email: staff.email, name: staff.name, role: "reception", permissions: ["guests"] });
      const staffId = invited.state.staff.find(member => member.email === staff.email).id;
      const blocker = await pool.connect(); let waiting;
      try {
        await blocker.query("BEGIN");
        const locked = await blocker.query("SELECT state_json FROM pms_properties WHERE id = $1 FOR UPDATE", [id]);
        // Begin the real application write while the owner holds the row lock.
        waiting = mutatePms(staff, id, invited.version, "saveGuest", { name: "Should never be saved" }).then(value => ({ value }), error => ({ error }));
        const next = applyPmsAction(JSON.parse(locked.rows[0].state_json), "saveStaff", { id: staffId, email: staff.email, name: staff.name, role: "reception", active: false, permissions: ["guests"] }, owner);
        await blocker.query("UPDATE pms_properties SET state_json = $1, version = version + 1 WHERE id = $2", [JSON.stringify(next), id]);
        await blocker.query("UPDATE pms_memberships SET active = false WHERE property_id = $1 AND staff_id = $2", [id, staffId]);
        await blocker.query("COMMIT");
      } catch (error) {
        await blocker.query("ROLLBACK"); throw error;
      } finally { blocker.release(); }
      const outcome = await waiting;
      assert.equal(outcome.error?.status, 403);
      const state = JSON.parse((await rawProperty(id)).state_json);
      assert.equal(state.guests.length, 0);
      await assert.rejects(readPms(staff, id), rejectsStatus(403));
    });

    await t.test("concurrent property creation enforces the owner limit atomically", async () => {
      const owner = actor("ownerlimit"); const now = new Date().toISOString();
      for (let i = 0; i < 19; i++) {
        const id = randomUUID(); const state = createInitialState(id, `Owner limit fixture ${i}`, "", owner, now);
        // Minimal setup needs only the owner lookup; the actual competing
        // creations must atomically insert both property and membership.
        await pool.query("INSERT INTO pms_properties (id, owner_user_id, name, state_json, version, mutation_id, created_at, updated_at) VALUES ($1,$2,$3,$4,0,$5,$6,$6)", [id, owner.userId, state.property.name, JSON.stringify(state), randomUUID(), now]);
      }
      const outcomes = await Promise.allSettled([createProperty(owner, { name: "Twentieth A" }), createProperty(owner, { name: "Twentieth B" })]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(outcomes.find(result => result.status === "rejected").reason.status, 400);
      const total = await pool.query("SELECT count(*)::int AS count FROM pms_properties WHERE owner_user_id = $1", [owner.userId]);
      assert.equal(total.rows[0].count, 20);
      const winner = outcomes.find(result => result.status === "fulfilled").value;
      const index = await pool.query("SELECT user_id FROM pms_memberships WHERE property_id = $1", [winner.state.property.id]);
      assert.deepEqual(index.rows, [{ user_id: owner.userId }]);
    });
  } finally {
    // Bound to UUID principals created above; never truncate or delete all rows.
    await pool.query("DELETE FROM pms_memberships WHERE property_id IN (SELECT id FROM pms_properties WHERE owner_user_id = ANY($1::text[]))", [owners]);
    await pool.query("DELETE FROM pms_properties WHERE owner_user_id = ANY($1::text[])", [owners]);
    await pool.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
});
