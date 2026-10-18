import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile(new URL("../lib/booking-display.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { getBookingRateSummary } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("fixed confirmed nightly price is shown without including guest extras", () => {
  const booking = { arrival: "2026-10-15", departure: "2026-10-17", roomTotalPaisa: 1200000, nightlyPricesPaisa: { "2026-10-15": 600000, "2026-10-16": 600000 }, extras: [{ amountPaisa: 50000 }] };
  const before = structuredClone(booking);
  assert.deepEqual(getBookingRateSummary(booking), { nights: 2, nightlyPaisa: 600000, isAverage: false });
  assert.deepEqual(booking, before);
});

test("varying nightly prices show an explicit average of the confirmed room total", () => {
  assert.deepEqual(getBookingRateSummary({ arrival: "2026-10-15", departure: "2026-10-17", roomTotalPaisa: 1300000, nightlyPricesPaisa: { "2026-10-15": 600000, "2026-10-16": 700000 } }), { nights: 2, nightlyPaisa: 650000, isAverage: true });
});

test("missing or stale nightly snapshots fall back to the agreed total and mark average", () => {
  assert.deepEqual(getBookingRateSummary({ arrival: "2026-10-15", departure: "2026-10-18", roomTotalPaisa: 1000000, nightlyPricesPaisa: {} }), { nights: 3, nightlyPaisa: 333333, isAverage: true });
  assert.equal(getBookingRateSummary({ arrival: "2026-10-15", departure: "2026-10-17", roomTotalPaisa: 1300000, nightlyPricesPaisa: { "2026-10-15": 600000, "2026-10-16": 600000 } }).isAverage, true);
});

test("single-night and zero-value bookings remain readable and invalid stays do not divide by zero", () => {
  assert.deepEqual(getBookingRateSummary({ arrival: "2026-10-15", departure: "2026-10-16", roomTotalPaisa: 600000, nightlyPricesPaisa: {} }), { nights: 1, nightlyPaisa: 600000, isAverage: false });
  assert.deepEqual(getBookingRateSummary({ arrival: "2026-10-15", departure: "2026-10-16", roomTotalPaisa: 0, nightlyPricesPaisa: {} }), { nights: 1, nightlyPaisa: 0, isAverage: false });
  assert.deepEqual(getBookingRateSummary({ arrival: "2026-10-15", departure: "2026-10-15", roomTotalPaisa: 0, nightlyPricesPaisa: {} }), { nights: 0, nightlyPaisa: 0, isAverage: false });
});
