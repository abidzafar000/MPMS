import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const typesUrl = moduleUrl(compile(await readFile(new URL("../lib/pms-types.ts", import.meta.url), "utf8")));
const withZod = source => source.replace(/from ["']zod["']/g, `from ${JSON.stringify(import.meta.resolve("zod"))}`);
const engineCode = withZod(compile(await readFile(new URL("../lib/pms-engine.ts", import.meta.url), "utf8"))).replace(/from ["']\.\/pms-types(?:\.ts)?["']/g, `from ${JSON.stringify(typesUrl)}`);
const engine = await import(moduleUrl(engineCode));
const { applyPmsAction, createInitialState, bookingBalance, memberPermissions, getMembership, validateBackup, PmsError } = engine;
const request = await import(moduleUrl(withZod(compile(await readFile(new URL("../lib/pms-request.ts", import.meta.url), "utf8")))));
const owner = { userId: "operations-owner", email: "owner@ops.test", name: "Operations Owner" };
const limited = { userId: "limited-staff", email: "limited@ops.test", name: "Limited Staff" };
const now = "2026-10-15T10:00:00.000Z";
const command = (state, action, payload, actor = owner) => applyPmsAction(state, action, payload, actor, now);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

function fixture() {
  let state = createInitialState("operations-property", "Operations Inn", "Lahore", owner, now);
  state = command(state, "saveRoomType", { name: "Double" });
  const typeId = state.roomTypes[0].id;
  for (const number of ["101", "102"]) state = command(state, "saveRoom", { number, typeId });
  state = command(state, "saveRatePlan", { name: "Flexible", typeId, basePaisa: 600000 });
  state = command(state, "saveGuest", { name: "Ali", phone: "03001234567", document: "Private CNIC", notes: "Private guest note" });
  state = command(state, "saveStaff", { email: limited.email, name: limited.name, role: "reception", permissions: ["bookings"] });
  return state;
}
function reserve(state, overrides = {}) {
  return command(state, "createReservation", { guestId: state.guests[0].id, roomId: state.rooms[0].id, arrival: "2026-10-15", departure: "2026-10-17", ratePlanId: state.ratePlans[0].id, ...overrides });
}
function rejects(state, action, payload, status = 400, actor = owner) {
  const before = JSON.stringify(state);
  assert.throws(() => command(state, action, payload, actor), error => error instanceof PmsError && (Array.isArray(status) ? status.includes(error.status) : error.status === status));
  assert.equal(JSON.stringify(state), before, "a rejected operation must not mutate saved records");
}

test("rooms with active bookings cannot be removed; checkout history survives archive and restore", () => {
  let state = reserve(fixture()); const bookingId = state.reservations[0].id; const roomId = state.rooms[0].id;
  rejects(state, "deleteRoom", { id: roomId }, 409);
  state = command(state, "setReservationStatus", { id: bookingId, status: "checked_in" });
  rejects(state, "archiveRoom", { id: roomId }, 409);
  state = command(state, "setReservationStatus", { id: bookingId, status: "checked_out" });
  assert.equal(bookingBalance(state, bookingId).balancePaisa, 1200000, "unpaid checkout retains the debt");
  state = command(state, "deleteRoom", { id: roomId });
  assert.equal(state.rooms[0].archived, true);
  assert.equal(state.reservations[0].roomId, roomId);
  rejects(state, "createReservation", { guestId: state.guests[0].id, roomId, arrival: "2026-10-18", departure: "2026-10-19", roomTotalPaisa: 600000 }, 409);
  state = command(state, "restoreRoom", { id: roomId });
  assert.equal(state.rooms[0].archived, false);
  assert.equal(state.reservations[0].status, "checked_out");
});

test("archived rooms are excluded from unassigned capacity and cannot silently oversell the remaining room", () => {
  let state = fixture(); const typeId = state.roomTypes[0].id;
  state = reserve(state, { roomId: undefined, roomTypeId: typeId });
  state = command(state, "archiveRoom", { id: state.rooms[1].id });
  rejects(state, "createReservation", { guestId: state.guests[0].id, roomTypeId: typeId, arrival: "2026-10-15", departure: "2026-10-17", roomTotalPaisa: 1200000 }, 409);
  rejects(state, "archiveRoom", { id: state.rooms[0].id }, 409);
  assert.equal(state.rooms[0].archived, undefined);
});

test("room types require no active rooms or plans; restoration checks active-name and room-number collisions", () => {
  let state = fixture(); const typeId = state.roomTypes[0].id;
  rejects(state, "archiveRoomType", { id: typeId }, 409);
  for (const room of state.rooms) state = command(state, "archiveRoom", { id: room.id });
  rejects(state, "archiveRoomType", { id: typeId }, 409);
  state = command(state, "saveRatePlan", { ...state.ratePlans[0], active: false });
  state = command(state, "deleteRoomType", { id: typeId });
  rejects(state, "restoreRoom", { id: state.rooms[0].id }, 409);
  state = command(state, "saveRoomType", { name: "Double" });
  rejects(state, "restoreRoomType", { id: typeId }, 409);
  const replacementType = state.roomTypes.at(-1).id;
  state = command(state, "archiveRoomType", { id: replacementType });
  state = command(state, "restoreRoomType", { id: typeId });
  state = command(state, "saveRoom", { number: "101", typeId });
  rejects(state, "restoreRoom", { id: state.rooms[0].id }, 409);
});

test("room moves and checkout queue one reusable housekeeping task; readiness completes tasks without clearing maintenance", () => {
  let state = reserve(fixture()); const bookingId = state.reservations[0].id; const firstRoomId = state.rooms[0].id;
  state = command(state, "setReservationStatus", { id: bookingId, status: "checked_in" });
  state = command(state, "updateReservation", { id: bookingId, roomId: state.rooms[1].id });
  assert.equal(state.rooms[0].status, "dirty");
  const firstTask = state.tasks.find(t => t.roomId === firstRoomId && t.status === "open");
  assert.ok(firstTask);
  state = command(state, "saveTask", { id: firstTask.id, roomId: firstRoomId, kind: "housekeeping", title: firstTask.title, assignedTo: state.staff[0].id, status: "open" });
  assert.match(state.audit.at(-1).detail, /Operations Owner/);
  state = command(state, "setRoomStatus", { id: firstRoomId, status: "clean" });
  assert.equal(state.tasks.find(t => t.id === firstTask.id).status, "done");
  state = command(state, "updateReservation", { id: bookingId, roomId: firstRoomId });
  state = command(state, "setReservationStatus", { id: bookingId, status: "checked_out" });
  assert.equal(state.tasks.filter(t => t.roomId === firstRoomId && t.kind === "housekeeping" && t.status === "open").length, 1);
  assert.equal(state.tasks.find(t => t.id === firstTask.id).status, "open", "reuse the task instead of appending duplicates");
  state = command(state, "setRoomStatus", { id: firstRoomId, status: "out_of_service" });
  state = command(state, "saveTask", { id: firstTask.id, roomId: firstRoomId, kind: "housekeeping", title: firstTask.title, status: "done" });
  assert.equal(state.rooms[0].status, "out_of_service");
});

test("extension requires an explicit price, preserves original nights and payments, and rejects overlaps atomically", () => {
  let state = reserve(fixture()); const original = structuredClone(state.reservations[0]);
  state = command(state, "openShift", { openingPaisa: 0 });
  state = command(state, "recordPayment", { reservationId: original.id, amountPaisa: 200000, method: "cash" }); const receipt = structuredClone(state.transactions[0]);
  rejects(state, "updateReservation", { id: original.id, departure: "2026-10-19" });
  rejects(state, "extendReservation", { id: original.id, departure: original.departure, additionalPaisa: 0 });
  state = command(state, "extendReservation", { id: original.id, departure: "2026-10-19", additionalPaisa: 100001, reason: "Guest agreed two extra nights" }, limited);
  const changed = state.reservations[0];
  for (const [day, value] of Object.entries(original.nightlyPricesPaisa)) assert.equal(changed.nightlyPricesPaisa[day], value);
  assert.equal(changed.nightlyPricesPaisa["2026-10-17"], 50001);
  assert.equal(changed.nightlyPricesPaisa["2026-10-18"], 50000);
  assert.equal(changed.roomTotalPaisa, 1300001);
  assert.deepEqual(state.transactions[0], receipt);
  assert.equal(bookingBalance(state, original.id).balancePaisa, 1100001);
  assert.match(state.audit.at(-1).detail, /100001/);
  state = reserve(state, { arrival: "2026-10-19", departure: "2026-10-21" });
  rejects(state, "extendReservation", { id: original.id, departure: "2026-10-20", additionalPaisa: 1 }, 409);
});

test("corporate details and receipts settle the company account without settling guest extras", () => {
  let state = reserve(fixture(), { payer: "company", companyName: "Acme Pakistan", companyAddress: "Office 4, Lahore" }); const bookingId = state.reservations[0].id;
  state = command(state, "addExtra", { id: bookingId, description: "Guest laundry", amountPaisa: 50000 });
  state = command(state, "updateReservation", { id: bookingId, companyAddress: "New corporate billing address" });
  state = command(state, "openShift", { openingPaisa: 0 });
  state = command(state, "recordPayment", { reservationId: bookingId, amountPaisa: 1200000, method: "bank", payer: "company", notes: "Company transfer" });
  const balance = bookingBalance(state, bookingId);
  assert.equal(balance.companyDuePaisa, 0); assert.equal(balance.guestDuePaisa, 50000);
  state = command(state, "setReservationStatus", { id: bookingId, status: "checked_in" });
  state = command(state, "setReservationStatus", { id: bookingId, status: "checked_out" });
  assert.equal(bookingBalance(state, bookingId).guestDuePaisa, 50000);
  assert.equal(state.reservations[0].companyName, "Acme Pakistan");
});

test("invoices scope corporate room charges and guest extras to separate bills and matching receipts", () => {
  let state = reserve(fixture(), { payer: "company", companyName: "Acme Pakistan", companyAddress: "Lahore" }); const bookingId = state.reservations[0].id;
  state = command(state, "addExtra", { id: bookingId, description: "Guest laundry", amountPaisa: 50000 });
  state = command(state, "openShift", { openingPaisa: 0 });
  state = command(state, "recordPayment", { reservationId: bookingId, amountPaisa: 200000, method: "bank", payer: "company" });
  state = command(state, "recordPayment", { reservationId: bookingId, amountPaisa: 10000, method: "cash", payer: "guest" });
  state = command(state, "issueInvoice", { reservationId: bookingId, kind: "invoice" });
  const companyInvoice = structuredClone(state.invoices[0]);
  assert.equal(companyInvoice.payer, "company"); assert.equal(companyInvoice.totalPaisa, 1200000); assert.equal(companyInvoice.paidPaisa, 200000); assert.equal(companyInvoice.balancePaisa, 1000000);
  assert.equal(companyInvoice.lineItems.length, 2); assert.match(companyInvoice.billTo, /Acme Pakistan/);
  state = command(state, "issueInvoice", { reservationId: bookingId, kind: "invoice", payer: "guest" });
  const guestInvoice = state.invoices[1];
  assert.equal(guestInvoice.totalPaisa, 50000); assert.equal(guestInvoice.roomTotalPaisa, 0); assert.equal(guestInvoice.paidPaisa, 10000); assert.equal(guestInvoice.balancePaisa, 40000); assert.equal(guestInvoice.billTo, "Ali");
  assert.equal(guestInvoice.lineItems[0].description, "Guest laundry");
  assert.deepEqual(state.invoices[0], companyInvoice);
  rejects(state, "issueInvoice", { reservationId: bookingId, kind: "invoice", payer: "company" }, 409);
});

test("OTA invoices do not mix guest extras or their cash receipts into settlement totals", () => {
  let state = reserve(fixture(), { payer: "ota", source: "Booking.com", sourceReference: "OTA123" }); const bookingId = state.reservations[0].id;
  state = command(state, "addExtra", { id: bookingId, description: "Breakfast", amountPaisa: 30000 });
  state = command(state, "openShift", { openingPaisa: 0 });
  state = command(state, "recordPayment", { reservationId: bookingId, amountPaisa: 30000, method: "cash", payer: "guest" });
  state = command(state, "issueInvoice", { reservationId: bookingId, kind: "proforma", payer: "ota" });
  const invoice = state.invoices[0];
  assert.equal(invoice.totalPaisa, 1200000); assert.equal(invoice.paidPaisa, 0); assert.equal(invoice.payer, "ota"); assert.match(invoice.billTo, /Booking.com.*OTA123/);
});

test("issued snapshots preserve prices and image branding; shared image data is stored only once", () => {
  let state = reserve(fixture()); const bookingId = state.reservations[0].id;
  state = command(state, "saveInvoiceBranding", { legalName: "Original Legal Name", address: "Hotel address", logoDataUrl: png, letterheadDataUrl: png });
  state = command(state, "issueInvoice", { reservationId: bookingId, kind: "proforma" });
  state = command(state, "issueInvoice", { reservationId: bookingId, kind: "proforma" });
  assert.equal(state.invoiceAssets.length, 1);
  const snapshot = structuredClone(state.invoices[0]);
  assert.equal(snapshot.branding.logoAssetId, snapshot.branding.letterheadAssetId);
  assert.ok(!("logoDataUrl" in snapshot.branding));
  state = command(state, "saveInvoiceBranding", { legalName: "New Name", logoDataUrl: "", letterheadDataUrl: "" });
  state = command(state, "setReservationPrice", { id: bookingId, amountPaisa: 999999, reason: "Revised guest agreement" });
  state = command(state, "saveGuest", { id: state.guests[0].id, name: "Ali Updated" });
  assert.deepEqual(state.invoices[0], snapshot);
  assert.equal(state.invoiceAssets.find(a => a.id === snapshot.branding.logoAssetId).dataUrl, png);
});

test("invoice and branding permissions, image types, payload amounts, and upload budget are enforced", () => {
  const state = reserve(fixture()); const bookingId = state.reservations[0].id;
  rejects(state, "issueInvoice", { reservationId: bookingId, kind: "invoice" }, 403, limited);
  rejects(state, "saveInvoiceBranding", { legalName: "Unauthorized" }, 403, limited);
  rejects(state, "issueInvoice", { reservationId: bookingId, kind: "invoice", totalPaisa: 1 });
  for (const url of ["https://example.com/logo.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/jpeg;base64,PHN2Zz4="]) rejects(state, "saveInvoiceBranding", { logoDataUrl: url });
  rejects(state, "saveInvoiceBranding", { logoDataUrl: `${png}${"A".repeat(200000)}` });
});

test("restore cannot discard or rewrite immutable invoices or their image registry", () => {
  let state = reserve(fixture()); const oldBackup = structuredClone(state);
  state = command(state, "saveInvoiceBranding", { logoDataUrl: png });
  state = command(state, "issueInvoice", { reservationId: state.reservations[0].id, kind: "proforma" });
  rejects(state, "restoreBackup", { backup: oldBackup, reason: "Discard invoice history" });
  const changedInvoice = structuredClone(state); changedInvoice.invoices[0].notes = "Rewritten after issue";
  rejects(state, "restoreBackup", { backup: changedInvoice, reason: "Rewrite immutable document" });
  const missingAsset = structuredClone(state); missingAsset.invoiceAssets = [];
  rejects(state, "restoreBackup", { backup: missingAsset, reason: "Delete invoice image" }, [400, 404]);
  const badAmounts = structuredClone(state); badAmounts.invoices[0].totalPaisa += 1;
  assert.throws(() => validateBackup(badAmounts), PmsError);
  const duplicated = structuredClone(state); duplicated.invoices.push(structuredClone(duplicated.invoices[0]));
  assert.throws(() => validateBackup(duplicated), PmsError);
});

test("legacy property state and corporate bookings remain valid without new optional fields", () => {
  let state = reserve(fixture(), { payer: "company", companyName: "Legacy company" });
  delete state.reservations[0].companyName; delete state.reservations[0].companyAddress;
  assert.equal(validateBackup(state).property.name, "Operations Inn");
  state = command(state, "updateReservation", { id: state.reservations[0].id, notes: "Historical booking retained" });
  state = command(state, "issueInvoice", { reservationId: state.reservations[0].id, kind: "proforma" });
  assert.equal(state.invoices[0].billTo, "Company account");
});

test("backup downloads and new export grants are disabled, including legacy export read shortcuts", async () => {
  let state = fixture();
  rejects(state, "exportBackup", {}, 410);
  rejects(state, "saveStaff", { email: "new@ops.test", name: "New staff", role: "reception", permissions: ["export"] });
  assert.equal(request.requestSchema.safeParse({ action: "exportBackup", propertyId: state.property.id, version: 0, payload: {} }).success, false);
  assert.throws(() => request.buildPmsRequest("exportBackup", {}), /no longer available/);
  state.staff[1].permissions = ["bookings", "export"];
  assert.ok(!memberPermissions(getMembership(state, limited)).includes("export"));
  const source = await readFile(new URL("../lib/server-pms.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function filterState"), source.indexOf("export async function readPms")).replace("export function", "function");
  const filterState = vm.runInNewContext(compile(body) + "\nfilterState;", { getMembership, memberPermissions, structuredClone });
  const filtered = filterState(state, limited);
  assert.equal(filtered.guests[0].document, ""); assert.equal(filtered.guests[0].notes, ""); assert.equal(filtered.wubook.propertyCode, "");
  assert.deepEqual(Array.from(filtered.invoices), []);
});
