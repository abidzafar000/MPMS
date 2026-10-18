import type { Invoice, InvoiceBranding, Payer, PmsState, Reservation } from "./pms-types";

export type InvoiceView = Omit<Invoice, "id" | "number" | "issuedAt" | "issuedBy" | "branding" | "chargeFingerprint"> & {
  number: string | null;
  issuedAt: string | null;
  branding: InvoiceBranding;
  draft: boolean;
};

export function invoiceBranding(state: PmsState): InvoiceBranding {
  return {
    legalName: state.property.name, address: state.property.city || "", phone: "", email: "",
    registrationNumber: "", footer: "", logoDataUrl: "", letterheadDataUrl: "",
    ...state.property.invoiceBranding,
  };
}

export function invoiceBillTo(state: PmsState, booking: Reservation, payer: Payer = booking.payer): string {
  const guest = state.guests.find(item => item.id === booking.guestId);
  if (payer === "ota") return `OTA settlement${booking.source ? ` · ${booking.source}` : ""}`;
  return payer === "company" && booking.companyName?.trim()
    ? [booking.companyName, booking.companyAddress].filter(Boolean).join("\n")
    : guest?.name || "Guest";
}

/** Preview only. issueInvoice calculates and persists the authoritative amounts. */
export function buildInvoicePreview(state: PmsState, booking: Reservation, kind: Invoice["kind"], billTo: string, notes: string, payer: Payer = booking.payer): InvoiceView {
  const guest = state.guests.find(item => item.id === booking.guestId);
  const room = state.rooms.find(item => item.id === booking.roomId);
  const nights = payer === booking.payer ? Object.entries(booking.nightlyPricesPaisa).sort(([a], [b]) => a.localeCompare(b)) : [];
  const lineItems = nights.map(([date, amount]) => ({
    id: `night-${date}`, description: `Room stay · ${date}`, quantity: 1, unitPaisa: amount, amountPaisa: amount,
  }));
  if (payer === "guest") for (const extra of booking.extras) lineItems.push({ id: extra.id, description: extra.description, quantity: 1, unitPaisa: extra.amountPaisa, amountPaisa: extra.amountPaisa });
  const roomTotalPaisa = payer === booking.payer ? booking.roomTotalPaisa : 0;
  const totalPaisa = roomTotalPaisa + (payer === "guest" ? booking.extras.reduce((sum, item) => sum + item.amountPaisa, 0) : 0);
  const paidPaisa = state.transactions.filter(item => item.reservationId === booking.id && item.payer === payer).reduce((sum, item) => sum + (item.kind === "payment" ? item.amountPaisa : item.kind === "refund" ? -item.amountPaisa : 0), 0);
  return {
    kind, payer, number: null, issuedAt: null, draft: true, reservationId: booking.id, bookingReference: booking.reference,
    guestName: guest?.name || "Guest", guestPhone: guest?.phone || "", companyName: booking.companyName || "", companyAddress: booking.companyAddress || "",
    billTo, roomNumber: room?.number || "Unassigned", arrival: booking.arrival, departure: booking.departure, currency: "PKR",
    lineItems, roomTotalPaisa, totalPaisa, paidPaisa, balancePaisa: totalPaisa - paidPaisa,
    dueDate: booking.dueDate, branding: invoiceBranding(state), notes,
  };
}

/** Resolve immutable issued assets, never the property's current replacement logo. */
export function savedInvoiceView(state: PmsState, invoice: Invoice): InvoiceView {
  const image = (id: string | null) => state.invoiceAssets?.find(asset => asset.id === id)?.dataUrl || "";
  const { logoAssetId, letterheadAssetId, ...branding } = invoice.branding;
  return { ...invoice, branding: { ...branding, logoDataUrl: image(logoAssetId), letterheadDataUrl: image(letterheadAssetId) }, draft: false };
}

export const invoiceMoney = (paisa: number) => `Rs ${new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paisa / 100)}`;

export function invoiceDate(value: string | null): string {
  if (!value) return "Not issued";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: value.length === 10 ? "UTC" : "Asia/Karachi" }).format(date);
}
