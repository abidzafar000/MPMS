import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const code = ts.transpileModule(await readFile(new URL("../lib/invoice-display.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { buildInvoicePreview, invoiceBillTo, invoiceBranding, savedInvoiceView, invoiceDate, invoiceMoney } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
function fixture() {
  const booking = { id: "booking", reference: "MH-TEST12345678", guestId: "guest", roomId: "room", arrival: "2026-10-15", departure: "2026-10-17", dueDate: "2026-10-17", payer: "guest", roomTotalPaisa: 1_200_000, nightlyPricesPaisa: { "2026-10-15": 500_000, "2026-10-16": 700_000 }, extras: [{ id: "laundry", description: "Laundry", amountPaisa: 150_000 }] };
  const state = { property: { name: "Guesthouse" }, guests: [{ id: "guest", name: "Ali", phone: "03001234567" }], rooms: [{ id: "room", number: "101" }], transactions: [{ reservationId: "booking", payer: "guest", kind: "payment", amountPaisa: 500_000 }, { reservationId: "booking", payer: "guest", kind: "refund", amountPaisa: 100_000 }, { reservationId: "other", payer: "guest", kind: "payment", amountPaisa: 900_000 }] };
  return { booking, state };
}

test("draft invoice derives exact room nights, extras and net receipts without changing property data", () => {
  const { booking, state } = fixture();
  const before = structuredClone({ booking, state });
  const draft = buildInvoicePreview(state, booking, "proforma", "Ali", "Arrival booking");
  assert.equal(draft.totalPaisa, 1_350_000);
  assert.equal(draft.paidPaisa, 400_000);
  assert.equal(draft.balancePaisa, 950_000);
  assert.deepEqual(draft.lineItems.map(item => item.amountPaisa), [500_000, 700_000, 150_000]);
  assert.equal(draft.lineItems.reduce((sum, item) => sum + item.amountPaisa, 0), draft.totalPaisa);
  assert.equal(draft.kind, "proforma");
  assert.equal(draft.number, null);
  assert.equal(draft.draft, true);
  assert.deepEqual({ booking, state }, before);
});

test("company-paid invoice defaults to actual company details, with a guest fallback for legacy records", () => {
  const { booking, state } = fixture();
  assert.equal(invoiceBillTo(state, { ...booking, payer: "company", companyName: "Atlas Trading", companyAddress: "Main Road\nLahore" }), "Atlas Trading\nMain Road\nLahore");
  assert.equal(invoiceBillTo(state, { ...booking, payer: "company" }), "Ali");
  assert.equal(invoiceBranding(state).legalName, "Guesthouse");
  assert.equal(invoiceBranding(state).logoDataUrl, "");
});

test("company room invoice and guest extras invoice use separate charges and receipts", () => {
  const { booking, state } = fixture();
  const corporate = { ...booking, payer: "company", companyName: "Atlas Trading", companyAddress: "Lahore" };
  state.transactions = [{ reservationId: booking.id, payer: "company", kind: "payment", amountPaisa: 700_000 }, { reservationId: booking.id, payer: "company", kind: "refund", amountPaisa: 100_000 }, { reservationId: booking.id, payer: "guest", kind: "payment", amountPaisa: 50_000 }];
  const company = buildInvoicePreview(state, corporate, "invoice", invoiceBillTo(state, corporate), "", "company");
  assert.deepEqual(company.lineItems.map(item => item.amountPaisa), [500_000, 700_000]);
  assert.equal(company.totalPaisa, 1_200_000);
  assert.equal(company.paidPaisa, 600_000);
  assert.equal(company.balancePaisa, 600_000);
  const guest = buildInvoicePreview(state, corporate, "invoice", invoiceBillTo(state, corporate, "guest"), "", "guest");
  assert.deepEqual(guest.lineItems.map(item => item.description), ["Laundry"]);
  assert.equal(guest.roomTotalPaisa, 0);
  assert.equal(guest.totalPaisa, 150_000);
  assert.equal(guest.paidPaisa, 50_000);
  assert.equal(guest.balancePaisa, 100_000);
  assert.equal(guest.billTo, "Ali");
});

test("OTA invoice preview excludes guest extras and guest-paid receipts", () => {
  const { booking, state } = fixture();
  const ota = { ...booking, payer: "ota", source: "Booking.com" };
  state.transactions = [{ reservationId: booking.id, payer: "ota", kind: "payment", amountPaisa: 300_000 }, { reservationId: booking.id, payer: "guest", kind: "payment", amountPaisa: 50_000 }];
  const preview = buildInvoicePreview(state, ota, "proforma", invoiceBillTo(state, ota, "ota"), "", "ota");
  assert.equal(preview.totalPaisa, 1_200_000);
  assert.equal(preview.paidPaisa, 300_000);
  assert.equal(preview.balancePaisa, 900_000);
  assert.equal(preview.billTo, "OTA settlement · Booking.com");
  assert.equal(preview.lineItems.length, 2);
});

test("issued documents resolve saved asset IDs instead of replacement property branding", () => {
  const { booking, state } = fixture();
  state.property.invoiceBranding = { ...invoiceBranding(state), legalName: "New property name", logoDataUrl: "data:image/png;base64,NEW" };
  state.invoiceAssets = [{ id: "old-logo", dataUrl: "data:image/png;base64,OLD" }];
  const draft = buildInvoicePreview(state, booking, "invoice", "Ali", "");
  const issued = { ...draft, id: "invoice", number: "INV-0001", issuedAt: "2026-10-15T23:30:00Z", branding: { legalName: "Original property name", address: "", phone: "", email: "", registrationNumber: "", footer: "", logoAssetId: "old-logo", letterheadAssetId: null } };
  const view = savedInvoiceView(state, issued);
  assert.equal(view.branding.legalName, "Original property name");
  assert.equal(view.branding.logoDataUrl, "data:image/png;base64,OLD");
  assert.equal(view.draft, false);
  assert.equal(view.number, "INV-0001");
});

test("invoice amounts keep paisa precision and issued dates follow Pakistan time", () => {
  assert.equal(invoiceMoney(1_200_001), "Rs 12,000.01");
  assert.equal(invoiceMoney(0), "Rs 0.00");
  assert.equal(invoiceDate("2026-10-15T23:30:00Z"), "16 Oct 2026");
  assert.equal(invoiceDate("2026-10-15"), "15 Oct 2026");
  assert.equal(invoiceDate(null), "Not issued");
});
