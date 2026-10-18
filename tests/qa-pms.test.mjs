import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// The application compiler supports extensionless TypeScript imports. Keep the
// acceptance runner dependency-free by transpiling these two local modules in
// memory, without modifying source or generating another compiled checkout.
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const typesUrl = moduleUrl(compile(await readFile(new URL("../lib/pms-types.ts", import.meta.url), "utf8")));
const engineCode = compile(await readFile(new URL("../lib/pms-engine.ts", import.meta.url), "utf8"))
  .replace(/from ["']\.\/pms-types(?:\.ts)?["']/g, `from ${JSON.stringify(typesUrl)}`)
  .replace(/from ["']zod["']/g, `from ${JSON.stringify(import.meta.resolve("zod"))}`);
const {
  createInitialState,
  applyPmsAction,
  bookingBalance,
  expectedCash,
  quoteStay,
  getMembership,
  PmsError,
} = await import(moduleUrl(engineCode));

const owner = { userId: "qa-owner", email: "owner@qa.test", name: "QA Owner" };
const receptionist = { userId: "qa-reception", email: "reception@qa.test", name: "QA Reception" };
const outsider = { userId: "qa-outsider", email: "outsider@qa.test", name: "Other Property" };
const at = "2026-10-11T18:00:00.000Z"; // 23:00 in Asia/Karachi.
const later = "2026-10-11T20:00:00.000Z"; // 01:00 on the next local day.

function command(state, action, payload, actor = owner, now = at) {
  return applyPmsAction(state, action, payload, actor, now);
}

function fixture(propertyId = "qa-property") {
  let state = createInitialState(propertyId, "QA Guesthouse", "Lahore", owner, at, false);
  state = command(state, "saveRoomType", { name: "Double" });
  const type = state.roomTypes.find((item) => item.name === "Double");
  state = command(state, "saveRoom", { number: "101", typeId: type.id, status: "clean" });
  state = command(state, "saveRoom", { number: "102", typeId: type.id, status: "clean" });
  state = command(state, "saveGuest", { name: "Ali QA", phone: "03001234567" });
  state = command(state, "saveRatePlan", { name: "Standard", typeId: type.id, basePaisa: 600_000, weekendPaisa: 700_000, weekendDays: [0, 6] });
  state = command(state, "saveStaff", { email: receptionist.email, name: receptionist.name, role: "reception", permissions: ["bookings", "guests", "payments", "shifts", "reports"] });
  return {
    state,
    typeId: type.id,
    roomId: state.rooms.find((item) => item.number === "101").id,
    secondRoomId: state.rooms.find((item) => item.number === "102").id,
    guestId: state.guests.find((item) => item.name === "Ali QA").id,
    planId: state.ratePlans.find((item) => item.name === "Standard").id,
  };
}

function reserve(f, overrides = {}) {
  const beforeIds = new Set(f.state.reservations.map((item) => item.id));
  f.state = command(f.state, "createReservation", {
    guestId: f.guestId,
    roomId: f.roomId,
    arrival: "2026-10-12",
    departure: "2026-10-14",
    ratePlanId: f.planId,
    payer: "guest",
    dueDate: "2026-10-12",
    ...overrides,
  });
  return f.state.reservations.find((item) => !beforeIds.has(item.id));
}

function rejects(state, action, payload, actor, statuses) {
  const before = structuredClone(state);
  assert.throws(() => command(state, action, payload, actor), (error) => {
    assert.ok(error instanceof PmsError, "rejection must be a controlled domain error");
    assert.ok(statuses.includes(error.status), `unexpected status ${error.status}: ${error.message}`);
    return true;
  });
  assert.deepEqual(state, before, "a failed command must not partially mutate the input state");
}

test("a physical room rejects overlaps while checkout-date adjacency stays available", () => {
  const f = fixture();
  reserve(f);
  rejects(f.state, "createReservation", { guestId: f.guestId, roomId: f.roomId, arrival: "2026-10-13", departure: "2026-10-15", ratePlanId: f.planId }, owner, [409]);
  const adjacent = reserve(f, { arrival: "2026-10-14", departure: "2026-10-15" });
  assert.equal(adjacent.arrival, "2026-10-14");
  assert.equal(f.state.reservations.length, 2);
});

test("unassigned room-type bookings consume inventory and cannot oversell physical capacity", () => {
  const f = fixture();
  const first = reserve(f, { roomId: undefined, roomTypeId: f.typeId });
  const second = reserve(f, { roomId: undefined, roomTypeId: f.typeId });
  assert.equal(first.roomId, null);
  assert.equal(second.roomId, null);
  rejects(f.state, "createReservation", { guestId: f.guestId, roomTypeId: f.typeId, arrival: "2026-10-12", departure: "2026-10-14", ratePlanId: f.planId }, owner, [409]);
  f.state = command(f.state, "updateReservation", { id: first.id, roomId: f.roomId });
  assert.equal(f.state.reservations.find((item) => item.id === first.id).roomId, f.roomId);
  rejects(f.state, "updateReservation", { id: second.id, roomId: f.roomId }, owner, [409]);
});

test("a conflicting stay extension fails without changing dates, bill, or history", () => {
  const f = fixture();
  const first = reserve(f);
  reserve(f, { arrival: "2026-10-14", departure: "2026-10-16" });
  rejects(f.state, "extendReservation", { id: first.id, departure: "2026-10-15", additionalPaisa: 600_000 }, receptionist, [409]);
  assert.equal(bookingBalance(f.state, first.id).totalPaisa, 1_200_000);
});

test("room cleanliness blocks check-in independently from booking availability", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "setRoomStatus", { id: f.roomId, status: "dirty" });
  rejects(f.state, "setReservationStatus", { id: booking.id, status: "checked_in" }, receptionist, [400, 409]);
  f.state = command(f.state, "setRoomStatus", { id: f.roomId, status: "clean" });
  f.state = command(f.state, "setReservationStatus", { id: booking.id, status: "checked_in" }, receptionist);
  assert.equal(f.state.reservations.find((item) => item.id === booking.id).status, "checked_in");
});

test("finishing housekeeping keeps a maintenance-blocked room out of service until explicit release", () => {
  const f = fixture();
  f.state = command(f.state, "setRoomStatus", { id: f.roomId, status: "out_of_service" });
  f.state = command(f.state, "saveTask", { roomId: f.roomId, kind: "housekeeping", title: "Clean after repair visit", status: "done" });
  assert.equal(f.state.tasks.at(-1).status, "done", "the cleaning task can be completed");
  assert.equal(f.state.rooms.find((item) => item.id === f.roomId).status, "out_of_service", "cleaning completion cannot clear a maintenance block");
  rejects(f.state, "createReservation", { guestId: f.guestId, roomId: f.roomId, arrival: "2026-10-12", departure: "2026-10-14", ratePlanId: f.planId }, owner, [409]);
  f.state = command(f.state, "setRoomStatus", { id: f.roomId, status: "clean" });
  reserve(f);
  assert.equal(f.state.reservations.length, 1, "explicit room release restores bookability");
});

test("restricted pricing/staff changes and non-member actions are denied", () => {
  const f = fixture();
  const booking = reserve(f);
  assert.ok(getMembership(f.state, receptionist));
  rejects(f.state, "setReservationPrice", { id: booking.id, amountPaisa: 900_000, reason: "Unauthorized discount" }, receptionist, [403]);
  rejects(f.state, "saveRatePlan", { id: f.planId, name: "Standard", typeId: f.typeId, basePaisa: 900_000 }, receptionist, [403]);
  rejects(f.state, "saveStaff", { email: outsider.email, name: outsider.name, role: "manager" }, receptionist, [403]);
  rejects(f.state, "saveGuest", { name: "Cross-property actor" }, outsider, [403]);
});

test("booking creation cannot bypass a restricted rate-plan price override", () => {
  const f = fixture();
  rejects(f.state, "createReservation", { guestId: f.guestId, roomId: f.roomId, arrival: "2026-10-12", departure: "2026-10-14", ratePlanId: f.planId, roomTotalPaisa: 100_000 }, receptionist, [403]);
  f.state = command(f.state, "createReservation", { guestId: f.guestId, roomId: f.roomId, arrival: "2026-10-12", departure: "2026-10-14", ratePlanId: f.planId }, receptionist);
  assert.equal(f.state.reservations.at(-1).roomTotalPaisa, 1_200_000);
});

test("a permitted rate-plan quote override needs a reason and an attributable audit entry", () => {
  const f = fixture();
  const payload = { guestId: f.guestId, roomId: f.roomId, arrival: "2026-10-12", departure: "2026-10-14", ratePlanId: f.planId, roomTotalPaisa: 1_000_000 };
  rejects(f.state, "createReservation", payload, owner, [400]);
  f.state = command(f.state, "createReservation", { ...payload, priceOverrideReason: "Owner approved repeat-guest discount" });
  assert.equal(f.state.reservations.at(-1).roomTotalPaisa, 1_000_000);
  const entry = f.state.audit.at(-1);
  assert.equal(entry.email, owner.email);
  assert.match(entry.detail, /Owner approved repeat-guest discount/);
  assert.match(entry.detail, /1200000/);
  assert.match(entry.detail, /1000000/);
});

test("other-property record IDs cannot be mutated in the current property", () => {
  const f = fixture("qa-property-a");
  const other = fixture("qa-property-b");
  const otherBooking = reserve(other);
  rejects(f.state, "updateReservation", { id: otherBooking.id, notes: "Cross-property attempt" }, owner, [404]);
  rejects(f.state, "recordPayment", { reservationId: otherBooking.id, amountPaisa: 100_000, method: "bank" }, owner, [404]);
});

test("partial guest receipts across two shifts reconcile without erasing guest debt", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 200_000 }, receptionist);
  const firstShiftId = f.state.shifts.at(-1).id;
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 500_000, method: "cash" }, receptionist);
  assert.equal(bookingBalance(f.state, booking.id).balancePaisa, 700_000);
  f.state = command(f.state, "closeShift", { shiftId: firstShiftId, countedPaisa: 700_000 }, receptionist);
  assert.equal(bookingBalance(f.state, booking.id).guestDuePaisa, 700_000);
  f.state = command(f.state, "openShift", { openingPaisa: 100_000 }, receptionist, later);
  const secondShiftId = f.state.shifts.at(-1).id;
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 700_000, method: "bank" }, receptionist, later);
  const receipts = f.state.transactions.filter((item) => item.reservationId === booking.id && item.kind === "payment");
  assert.deepEqual(receipts.map((item) => item.shiftId), [firstShiftId, secondShiftId]);
  assert.equal(new Set(receipts.map((item) => item.receipt)).size, 2);
  assert.equal(bookingBalance(f.state, booking.id).balancePaisa, 0);
  assert.equal(expectedCash(f.state, f.state.shifts.at(-1)), 100_000);
});

test("OTA and company balances remain separate from guest debt and reception cash", () => {
  const f = fixture();
  const otaBooking = reserve(f, { payer: "ota", source: "Booking.com", sourceReference: "OTA-QA-1" });
  const companyBooking = reserve(f, { roomId: f.secondRoomId, payer: "company", companyName: "QA Company", source: "Company" });
  f.state = command(f.state, "openShift", { openingPaisa: 200_000 });
  assert.equal(bookingBalance(f.state, otaBooking.id).guestDuePaisa, 0);
  assert.equal(bookingBalance(f.state, otaBooking.id).otaDuePaisa, 1_200_000);
  assert.equal(bookingBalance(f.state, companyBooking.id).companyDuePaisa, 1_200_000);
  f.state = command(f.state, "addExtra", { id: otaBooking.id, description: "Guest laundry", amountPaisa: 100_000 });
  assert.equal(bookingBalance(f.state, otaBooking.id).guestDuePaisa, 100_000);
  f.state = command(f.state, "recordPayment", { reservationId: otaBooking.id, amountPaisa: 1_200_000, method: "ota", payer: "ota", notes: "Verified settlement" });
  assert.equal(expectedCash(f.state, f.state.shifts.at(-1)), 200_000);
  assert.equal(bookingBalance(f.state, otaBooking.id).otaDuePaisa, 0);
  assert.equal(bookingBalance(f.state, otaBooking.id).guestDuePaisa, 100_000, "OTA room settlement must not pay guest extras");
  assert.equal(bookingBalance(f.state, companyBooking.id).companyDuePaisa, 1_200_000);
});

test("cross-midnight shift counts cash movements/refunds once and preserves the closed snapshot", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 200_000 });
  const shiftId = f.state.shifts.at(-1).id;
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 500_000, method: "cash" });
  const cashPaymentId = f.state.transactions.at(-1).id;
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 700_000, method: "bank" });
  f.state = command(f.state, "cashMovement", { kind: "add", amountPaisa: 30_000, notes: "Extra float" });
  f.state = command(f.state, "cashMovement", { kind: "expense", amountPaisa: 50_000, notes: "Cleaning supplies" });
  f.state = command(f.state, "cashMovement", { kind: "withdrawal", amountPaisa: 100_000, notes: "Safe transfer" });
  f.state = command(f.state, "recordRefund", { paymentId: cashPaymentId, amountPaisa: 100_000, notes: "Approved adjustment" });
  assert.equal(expectedCash(f.state, f.state.shifts.at(-1)), 480_000);
  rejects(f.state, "closeShift", { shiftId, countedPaisa: 475_000 }, owner, [400]);
  f.state = command(f.state, "closeShift", { shiftId, countedPaisa: 475_000, notes: "Rs 50 shortage counted at handover" }, owner, later);
  const closed = structuredClone(f.state.shifts.find((item) => item.id === shiftId));
  assert.equal(closed.openedAt, at);
  assert.equal(closed.closedAt, later);
  assert.equal(closed.expectedPaisa, 480_000);
  assert.equal(closed.variancePaisa, -5_000);
  rejects(f.state, "closeShift", { shiftId, countedPaisa: 480_000, notes: "Rewrite old close" }, owner, [400, 409]);
  rejects(f.state, "cashMovement", { kind: "expense", amountPaisa: 10_000, notes: "After close" }, owner, [400, 409]);
  f.state = command(f.state, "openShift", { openingPaisa: 100_000 }, owner, later);
  assert.deepEqual(f.state.shifts.find((item) => item.id === shiftId), closed);
});

test("paid cancellation retains money/audit, releases inventory, and allows an explicit charge correction", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 0 });
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 500_000, method: "cash" });
  const payment = structuredClone(f.state.transactions.at(-1));
  f.state = command(f.state, "setReservationStatus", { id: booking.id, status: "cancelled", reason: "Guest cancelled; manager to resolve deposit" });
  assert.deepEqual(f.state.transactions.find((item) => item.id === payment.id), payment);
  assert.equal(bookingBalance(f.state, booking.id).paidPaisa, 500_000);
  assert.equal(bookingBalance(f.state, booking.id).balancePaisa, 700_000);
  assert.ok(f.state.audit.some((item) => item.action === "setReservationStatus" && item.email === owner.email));
  reserve(f); // Cancellation releases the room's occupied nights.
  f.state = command(f.state, "setReservationPrice", { id: booking.id, amountPaisa: 500_000, reason: "Approved cancellation fee equals retained deposit" });
  assert.equal(bookingBalance(f.state, booking.id).balancePaisa, 0);
});

test("a cash refund from a previous shift needs enough cash in the current drawer", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 0 });
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 500_000, method: "cash" });
  const paymentId = f.state.transactions.at(-1).id;
  f.state = command(f.state, "closeShift", { shiftId: f.state.shifts.at(-1).id, countedPaisa: 500_000 });
  f.state = command(f.state, "openShift", { openingPaisa: 0 }, owner, later);
  rejects(f.state, "recordRefund", { paymentId, amountPaisa: 500_000, notes: "Deposit refund in next shift" }, owner, [400, 409]);
  f.state = command(f.state, "cashMovement", { kind: "add", amountPaisa: 500_000, notes: "Cash supplied by owner for refund" });
  f.state = command(f.state, "recordRefund", { paymentId, amountPaisa: 500_000, notes: "Deposit returned" });
  assert.equal(expectedCash(f.state, f.state.shifts.at(-1)), 0);
});

test("rate changes affect new quotes without repricing an existing confirmed reservation", () => {
  const f = fixture();
  const original = structuredClone(reserve(f));
  f.state = command(f.state, "saveRatePlan", { id: f.planId, name: "Standard", typeId: f.typeId, basePaisa: 650_000, weekendPaisa: 700_000, weekendDays: [0, 6], overrides: { "2026-10-12": 900_000, "2026-10-17": 900_000 } });
  const existing = f.state.reservations.find((item) => item.id === original.id);
  assert.equal(existing.roomTotalPaisa, 1_200_000);
  assert.deepEqual(existing.nightlyPricesPaisa, original.nightlyPricesPaisa);
  const fresh = reserve(f, { roomId: f.secondRoomId });
  assert.equal(fresh.roomTotalPaisa, 1_550_000);
  const quote = quoteStay(f.state, f.roomId, f.planId, "2026-10-17", "2026-10-18");
  const quotedTotal = typeof quote === "number" ? quote : quote.roomTotalPaisa ?? quote.totalPaisa;
  assert.equal(quotedTotal, 900_000, "dated price must take precedence over weekend/default pricing");
});

test("an inactive plan does not block an existing booking's notes, due date, or same-type room move", () => {
  const f = fixture();
  const original = structuredClone(reserve(f));
  const plan = f.state.ratePlans.find((item) => item.id === f.planId);
  f.state = command(f.state, "saveRatePlan", { ...plan, active: false });
  f.state = command(f.state, "updateReservation", { id: original.id, notes: "Late arrival confirmed", dueDate: "2026-10-13" }, receptionist);
  let changed = f.state.reservations.find((item) => item.id === original.id);
  assert.equal(changed.notes, "Late arrival confirmed");
  assert.equal(changed.dueDate, "2026-10-13");
  assert.equal(changed.roomTotalPaisa, original.roomTotalPaisa);
  assert.deepEqual(changed.nightlyPricesPaisa, original.nightlyPricesPaisa);
  f.state = command(f.state, "updateReservation", { id: original.id, roomId: f.secondRoomId }, receptionist);
  changed = f.state.reservations.find((item) => item.id === original.id);
  assert.equal(changed.roomId, f.secondRoomId);
  assert.equal(changed.roomTotalPaisa, original.roomTotalPaisa);
  assert.deepEqual(changed.nightlyPricesPaisa, original.nightlyPricesPaisa);
});

test("explicit complimentary extensions preserve old nightly charges and work with inactive historical plans", () => {
  for (const active of [true, false]) {
    const f = fixture();
    const original = structuredClone(reserve(f));
    if (!active) {
      const plan = f.state.ratePlans.find((item) => item.id === f.planId);
      f.state = command(f.state, "saveRatePlan", { ...plan, active: false });
    }
    f.state = command(f.state, "extendReservation", { id: original.id, departure: "2026-10-16", additionalPaisa: 0, reason: "Agreed complimentary nights" }, receptionist);
    const changed = f.state.reservations.find((item) => item.id === original.id);
    assert.equal(changed.departure, "2026-10-16");
    assert.equal(changed.roomTotalPaisa, original.roomTotalPaisa, "explicit zero-priced extra nights keep the agreed total unchanged");
    for (const [day, price] of Object.entries(original.nightlyPricesPaisa)) assert.equal(changed.nightlyPricesPaisa[day], price);
    assert.deepEqual(Object.keys(changed.nightlyPricesPaisa).sort(), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
    assert.equal(Object.values(changed.nightlyPricesPaisa).reduce((sum, amount) => sum + amount, 0), original.roomTotalPaisa);
  }
});

test("authorized booking override keeps receipt records and records the actor/reason", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 0 });
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 500_000, method: "cash" });
  const payment = structuredClone(f.state.transactions.at(-1));
  f.state = command(f.state, "setReservationPrice", { id: booking.id, amountPaisa: 1_000_000, reason: "Manager agreed Rs 2,000 discount" });
  assert.equal(bookingBalance(f.state, booking.id).balancePaisa, 500_000);
  assert.deepEqual(f.state.transactions.find((item) => item.id === payment.id), payment);
  const entry = f.state.audit.at(-1);
  assert.equal(entry.action, "setReservationPrice");
  assert.equal(entry.email, owner.email);
  assert.match(entry.detail, /Manager agreed Rs 2,000 discount/);
});

test("deactivated staff lose access but keep attribution on old receipts and shifts", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 0 }, receptionist);
  const shiftId = f.state.shifts.at(-1).id;
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 500_000, method: "cash" }, receptionist);
  f.state = command(f.state, "closeShift", { shiftId, countedPaisa: 500_000 }, receptionist);
  const oldReceipt = structuredClone(f.state.transactions.at(-1));
  const oldShift = structuredClone(f.state.shifts.at(-1));
  const staff = f.state.staff.find((item) => item.email === receptionist.email);
  f.state = command(f.state, "saveStaff", { id: staff.id, email: staff.email, name: staff.name, role: "reception", active: false, permissions: staff.permissions });
  rejects(f.state, "saveGuest", { name: "Disabled access" }, receptionist, [403]);
  assert.deepEqual(f.state.transactions.find((item) => item.id === oldReceipt.id), oldReceipt);
  assert.deepEqual(f.state.shifts.find((item) => item.id === oldShift.id), oldShift);
});

test("planned staff shifts can cross midnight and remain distinct from actual cashier sessions", () => {
  const f = fixture();
  const staffId = f.state.staff.find((item) => item.email === receptionist.email).id;
  f.state = command(f.state, "saveShiftAssignment", { staffId, startAt: "2026-10-11T23:00:00+05:00", endAt: "2026-10-12T01:00:00+05:00", notes: "Night reception" });
  assert.equal(f.state.shiftAssignments.length, 1);
  assert.equal(f.state.shifts.length, 0, "scheduling staff does not open a cash drawer");
  rejects(f.state, "saveShiftAssignment", { staffId, startAt: "2026-10-12T00:30:00+05:00", endAt: "2026-10-12T02:00:00+05:00" }, owner, [409]);
  f.state = command(f.state, "saveShiftAssignment", { staffId, startAt: "2026-10-12T01:00:00+05:00", endAt: "2026-10-12T03:00:00+05:00" });
  assert.equal(f.state.shiftAssignments.length, 2);
});

test("backup restore reproduces bookings/balances but rejects foreign property and dangling ledger references", () => {
  const f = fixture();
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 200_000 });
  f.state = command(f.state, "recordPayment", { reservationId: booking.id, amountPaisa: 500_000, method: "cash" });
  f.state = command(f.state, "closeShift", { shiftId: f.state.shifts.at(-1).id, countedPaisa: 700_000 });
  const backup = structuredClone(f.state);
  f.state = command(f.state, "addExtra", { id: booking.id, description: "Late-added minibar", amountPaisa: 50_000 });
  f.state = command(f.state, "restoreBackup", { backup, reason: "QA recovery exercise" });
  assert.deepEqual(f.state.reservations, backup.reservations);
  assert.deepEqual(f.state.transactions, backup.transactions);
  assert.equal(bookingBalance(f.state, booking.id).balancePaisa, 700_000);
  const foreign = structuredClone(backup);
  foreign.property.id = "other-property";
  rejects(f.state, "restoreBackup", { backup: foreign, reason: "Foreign property" }, owner, [400, 403]);
  const dangling = structuredClone(backup);
  dangling.transactions[0].reservationId = "missing-booking";
  rejects(f.state, "restoreBackup", { backup: dangling, reason: "Broken ledger" }, owner, [400, 404]);
  const rewrittenClose = structuredClone(backup);
  rewrittenClose.shifts[0].expectedPaisa = 1;
  rejects(f.state, "restoreBackup", { backup: rewrittenClose, reason: "Invalid close" }, owner, [400]);
});

test("money/date validation rejects impossible input instead of persisting corrupt financial records", () => {
  const f = fixture();
  rejects(f.state, "createReservation", { guestId: f.guestId, roomId: f.roomId, arrival: "2026-02-30", departure: "2026-03-02", ratePlanId: f.planId }, owner, [400]);
  const booking = reserve(f);
  f.state = command(f.state, "openShift", { openingPaisa: 0 });
  for (const amountPaisa of [-1, 0, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    rejects(f.state, "recordPayment", { reservationId: booking.id, amountPaisa, method: "cash" }, owner, [400]);
  }
});
