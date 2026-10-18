import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const typesUrl = moduleUrl(compile(await readFile(new URL("../lib/pms-types.ts", import.meta.url), "utf8")));
const engineCode = compile(await readFile(new URL("../lib/pms-engine.ts", import.meta.url), "utf8"))
  .replace(/from ["']\.\/pms-types(?:\.ts)?["']/g, `from ${JSON.stringify(typesUrl)}`)
  .replace(/from ["']zod["']/g, `from ${JSON.stringify(import.meta.resolve("zod"))}`);
const { generateBookingReference, createInitialState, applyPmsAction, validateBackup, PmsError } = await import(moduleUrl(engineCode));

test("cryptographic booking numbers are readable alphanumeric codes with unique property references", () => {
  const existing = new Set(["BK-00001"]);
  for (let i = 0; i < 200; i++) {
    const reference = generateBookingReference(existing);
    assert.match(reference, /^MH-[2-9A-HJ-NP-Z]{12}$/);
    assert.match(reference.slice(3), /[2-9]/, "every code includes a digit as well as its letter prefix");
    assert.ok(!existing.has(reference));
    existing.add(reference);
  }
  assert.equal(existing.size, 201);
});

test("a forced collision retries against all stored references without changing legacy codes", () => {
  const existing = ["BK-00001", "mh-222222222222"];
  let calls = 0;
  const reference = generateBookingReference(existing, bytes => { bytes.fill(calls++ === 0 ? 0 : 1); });
  assert.equal(reference, "MH-333333333333");
  assert.equal(calls, 2);
  assert.deepEqual(existing, ["BK-00001", "mh-222222222222"]);
});

test("an all-letter random suffix is regenerated to guarantee an alphanumeric booking number", () => {
  let calls = 0;
  const reference = generateBookingReference([], bytes => { bytes.fill(calls++ === 0 ? 8 : 2); });
  assert.equal(reference, "MH-444444444444");
  assert.equal(calls, 2);
});

test("repeated collisions fail safely rather than returning a duplicate or sequential fallback", () => {
  let calls = 0;
  assert.throws(() => generateBookingReference(["MH-222222222222"], bytes => { calls++; bytes.fill(0); }), error => error instanceof PmsError && error.status === 503);
  assert.equal(calls, 64);
});

const owner = { userId: "booking-number-owner", email: "owner@booking.test", name: "Owner" };
const at = "2026-10-15T10:00:00.000Z";
const command = (state, action, payload) => applyPmsAction(state, action, payload, owner, at);
function fixture() {
  let state = createInitialState("booking-number-property", "Reference Guesthouse", "Lahore", owner, at, true);
  state = command(state, "saveGuest", { name: "Ali", phone: "03001234567" });
  return state;
}
function reserve(state, overrides = {}) {
  return command(state, "createReservation", {
    guestId: state.guests[0].id, roomId: state.rooms[0].id,
    arrival: "2026-10-15", departure: "2026-10-17",
    ratePlanId: state.ratePlans[0].id, ...overrides,
  });
}

test("a newly created booking keeps its shared number through edit, price correction, and cancellation", () => {
  let state = reserve(fixture());
  const booking = structuredClone(state.reservations[0]);
  assert.match(booking.reference, /^MH-[2-9A-HJ-NP-Z]{12}$/);
  assert.notEqual(booking.reference, booking.id, "sharing never requires the internal record ID");
  state = command(state, "extendReservation", { id: booking.id, departure: "2026-10-18", additionalPaisa: 400000, reason: "Guest agreed to the extra night" });
  state = command(state, "setReservationPrice", { id: booking.id, amountPaisa: 1800000, reason: "Agreed extension price" });
  state = command(state, "setReservationStatus", { id: booking.id, status: "cancelled", reason: "Guest cancelled" });
  assert.equal(state.reservations[0].reference, booking.reference);
  assert.equal(state.reservations[0].id, booking.id);
  assert.equal(state.audit.filter(entry => entry.action === "createReservation").at(-1).detail, booking.reference);
});

test("legacy booking references remain intact through new bookings and backup restoration", () => {
  let state = reserve(fixture());
  state.reservations[0].reference = "BK-00001";
  const legacyId = state.reservations[0].id;
  state = reserve(state, { roomId: state.rooms[1].id });
  assert.equal(state.reservations.find(r => r.id === legacyId).reference, "BK-00001");
  const newReference = state.reservations[1].reference;
  assert.match(newReference, /^MH-[2-9A-HJ-NP-Z]{12}$/);
  const backup = validateBackup(JSON.parse(JSON.stringify(state)));
  state = command(state, "restoreBackup", { backup, reason: "Verify historical booking-number preservation" });
  assert.equal(state.reservations.find(r => r.id === legacyId).reference, "BK-00001");
  assert.equal(state.reservations[1].reference, newReference);
});

test("booking creation rejects caller-supplied reference codes", () => {
  const state = fixture();
  assert.throws(() => reserve(state, { reference: "MH-CALLER222222" }), error => error instanceof PmsError && error.status === 400);
  assert.equal(state.reservations.length, 0);
});
