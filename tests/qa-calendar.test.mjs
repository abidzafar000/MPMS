import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the layout helper actually used by the calendar without requiring
// a browser/runtime or emitting another compiled source tree.
const source = await readFile(new URL("../lib/calendar-layout.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { getCalendarBarLayout } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const calendarStart = "2026-10-14";

test("one-night booking occupies arrival afternoon through checkout morning", () => {
  assert.deepEqual(getCalendarBarLayout("2026-10-14", "2026-10-15", calendarStart), { start: 0.5, end: 1.5 });
});

test("two-night booking preserves complete nights between half-day endpoints", () => {
  assert.deepEqual(getCalendarBarLayout("2026-10-14", "2026-10-16", calendarStart), { start: 0.5, end: 2.5 });
});

test("same-day checkout and new arrival share a boundary without overlapping bars", () => {
  const leaving = getCalendarBarLayout("2026-10-14", "2026-10-15", calendarStart);
  const arriving = getCalendarBarLayout("2026-10-15", "2026-10-16", calendarStart);
  assert.deepEqual(leaving, { start: 0.5, end: 1.5 });
  assert.deepEqual(arriving, { start: 1.5, end: 2.5 });
  assert.equal(leaving.end, arriving.start);
});

test("checkout on the first visible day remains visible through its morning half", () => {
  assert.deepEqual(getCalendarBarLayout("2026-10-13", "2026-10-14", calendarStart), { start: 0, end: 0.5 });
});

test("arrival on the last visible day begins in its afternoon and clips at the week edge", () => {
  assert.deepEqual(getCalendarBarLayout("2026-10-20", "2026-10-21", calendarStart), { start: 6.5, end: 7 });
});

test("a stay spanning the calendar clips both endpoints to the visible week", () => {
  assert.deepEqual(getCalendarBarLayout("2026-10-12", "2026-10-23", calendarStart), { start: 0, end: 7 });
});

test("stays completely outside the visible interval produce no bar", () => {
  assert.equal(getCalendarBarLayout("2026-10-10", "2026-10-13", calendarStart), null);
  assert.equal(getCalendarBarLayout("2026-10-21", "2026-10-23", calendarStart), null);
});

test("invalid calendar dates and nonpositive stays fail safely", () => {
  for (const args of [
    ["2026-10-14", "2026-10-14", calendarStart],
    ["2026-10-15", "2026-10-14", calendarStart],
    ["2026-02-30", "2026-03-02", "2026-02-28"],
    ["2026-10-14", "2026-13-01", calendarStart],
    ["not-a-date", "2026-10-15", calendarStart],
    ["2026-10-14", "", calendarStart],
    ["2026-10-14", "2026-10-15", "invalid-start"],
  ]) assert.equal(getCalendarBarLayout(...args), null, args.join(" / "));
});

test("month, year and leap-day boundaries keep civil-day distances", () => {
  assert.deepEqual(getCalendarBarLayout("2026-10-31", "2026-11-01", "2026-10-30"), { start: 1.5, end: 2.5 });
  assert.deepEqual(getCalendarBarLayout("2026-12-31", "2027-01-01", "2026-12-30"), { start: 1.5, end: 2.5 });
  assert.deepEqual(getCalendarBarLayout("2028-02-28", "2028-03-01", "2028-02-27"), { start: 1.5, end: 3.5 });
});

test("explicit visible-day counts control clipping and reject unusable ranges", () => {
  assert.deepEqual(getCalendarBarLayout("2026-10-16", "2026-10-18", calendarStart, 3), { start: 2.5, end: 3 });
  assert.deepEqual(getCalendarBarLayout("2026-10-12", "2026-10-23", calendarStart, 3), { start: 0, end: 3 });
  for (const visibleDays of [0, -1, Number.NaN]) {
    assert.equal(getCalendarBarLayout("2026-10-14", "2026-10-15", calendarStart, visibleDays), null);
  }
});
