import { z } from "zod";
import { PERMISSIONS, type Actor, type Invoice, type InvoiceBranding, type Permission, type PmsAction, type PmsState, type Reservation, type Room, type Shift, type Staff } from "./pms-types";

export class PmsError extends Error { constructor(public status: number, message: string, public currentVersion?: number) { super(message); this.name = "PmsError"; } }
function fail(message: string, status = 400): never { throw new PmsError(status, message); }
const id = () => crypto.randomUUID();
const BOOKING_REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Guest-facing identifier; internal reservation IDs remain separate and unchanged. */
export function generateBookingReference(
  existingReferences: Iterable<string>,
  fillRandom: (bytes: Uint8Array) => void = bytes => { crypto.getRandomValues(bytes); },
): string {
  const existing = new Set(Array.from(existingReferences, reference => reference.toUpperCase()));
  for (let attempt = 0; attempt < 64; attempt++) {
    const bytes = new Uint8Array(12);
    fillRandom(bytes);
    // A 32-character alphabet divides all 256 byte values evenly. Twelve
    // independent characters provide 60 random bits before the digit check.
    const suffix = Array.from(bytes, byte => BOOKING_REFERENCE_ALPHABET[byte & 31]).join("");
    if (!/[2-9]/.test(suffix)) continue;
    const reference = `MH-${suffix}`;
    if (!existing.has(reference)) return reference;
  }
  return fail("A unique booking number could not be generated. Please retry.", 503);
}

const text = z.string().trim().max(2000);
const label = z.string().trim().min(1).max(120);
const ident = z.string().min(1).max(100);
const money = z.number().int().min(0).max(100000000000);
const positive = money.min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v, "Invalid calendar date");
const instant = z.string().datetime({ offset: true });
const permission = z.enum(PERMISSIONS);
const roomStatus = z.enum(["clean", "dirty", "out_of_service"]);
const bookingStatus = z.enum(["reserved", "checked_in", "checked_out", "cancelled", "no_show"]);
const payer = z.enum(["guest", "ota", "company"]);
const method = z.enum(["cash", "bank", "easypaisa", "jazzcash", "ota"]);
const guestFields = { name: label, phone: text.optional(), document: text.optional(), notes: text.optional() };
const mapping = z.array(z.object({ localId: ident, remoteId: ident }).strict()).max(500);
const imageDataUrl = z.string().max(200000).refine(value => {
  if (!value) return true;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  try {
    const bytes = atob(match[2]);
    return match[1] === "png" ? bytes.startsWith("\x89PNG\r\n\x1a\n") : match[1] === "jpeg" ? bytes.startsWith("\xff\xd8\xff") : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  } catch { return false; }
}, "Upload a PNG, JPEG, or WebP image with valid image content.");
const brandingFields = { legalName: text.max(120), address: text, phone: text.max(100), email: z.string().trim().max(254).refine(v => !v || z.string().email().safeParse(v).success, "Enter a valid email address."), registrationNumber: text.max(120), footer: text, logoDataUrl: imageDataUrl, letterheadDataUrl: imageDataUrl };
const brandingBaseSchema = z.object(brandingFields).strict();
const brandingSchema = brandingBaseSchema.refine(b => b.logoDataUrl.length + b.letterheadDataUrl.length <= 200000, "Combined invoice images must not exceed 200,000 data URL characters.");
const invoiceBrandingSnapshotSchema = brandingBaseSchema.omit({ logoDataUrl: true, letterheadDataUrl: true }).extend({ logoAssetId: ident.nullable(), letterheadAssetId: ident.nullable() }).strict();
const invoiceSchema = z.object({ id: ident, kind: z.enum(["proforma", "invoice"]), payer, number: label, issuedAt: instant, issuedBy: ident, reservationId: ident, bookingReference: label, guestName: label, guestPhone: text, companyName: text.max(200), companyAddress: text, billTo: z.string().trim().max(2400), roomNumber: text, arrival: date, departure: date, currency: z.literal("PKR"), lineItems: z.array(z.object({ id: ident, description: text, quantity: z.number().int().positive(), unitPaisa: money, amountPaisa: money }).strict()).min(1), roomTotalPaisa: money, totalPaisa: z.number().int().nonnegative().safe(), paidPaisa: z.number().int().nonnegative().safe(), balancePaisa: z.number().int().safe(), dueDate: date, branding: invoiceBrandingSnapshotSchema, notes: text, chargeFingerprint: z.string().max(150000) }).strict();
const schemas = {
  saveRoomType: z.object({ id: ident.optional(), name: label }).strict(),
  archiveRoomType: z.object({ id: ident }).strict(), deleteRoomType: z.object({ id: ident }).strict(), restoreRoomType: z.object({ id: ident }).strict(),
  saveRoom: z.object({ id: ident.optional(), number: label, typeId: ident, status: roomStatus.optional(), notes: text.optional() }).strict(),
  archiveRoom: z.object({ id: ident }).strict(), deleteRoom: z.object({ id: ident }).strict(), restoreRoom: z.object({ id: ident }).strict(),
  setRoomStatus: z.object({ id: ident, status: roomStatus }).strict(),
  saveGuest: z.object({ id: ident.optional(), ...guestFields }).strict(),
  createReservation: z.object({ guestId: ident.optional(), guest: z.object(guestFields).strict().optional(), roomId: ident.optional(), roomTypeId: ident.optional(), arrival: date, departure: date, ratePlanId: ident.optional(), roomTotalPaisa: money.optional(), priceOverrideReason: text.optional(), source: text.optional(), sourceReference: text.optional(), payer: payer.optional(), companyName: text.max(200).optional(), companyAddress: text.optional(), dueDate: date.optional(), notes: text.optional() }).strict(),
  updateReservation: z.object({ id: ident, roomId: ident.nullable().optional(), roomTypeId: ident.optional(), arrival: date.optional(), departure: date.optional(), dueDate: date.optional(), notes: text.optional(), companyName: text.max(200).optional(), companyAddress: text.optional() }).strict(),
  extendReservation: z.object({ id: ident, departure: date, additionalPaisa: money, reason: text.optional() }).strict(),
  setReservationStatus: z.object({ id: ident, status: bookingStatus, reason: text.optional() }).strict(),
  setReservationPrice: z.object({ id: ident, amountPaisa: money, reason: label }).strict(),
  addExtra: z.object({ id: ident, description: label, amountPaisa: positive }).strict(),
  recordPayment: z.object({ reservationId: ident, amountPaisa: positive, method, payer: payer.optional(), notes: text.optional() }).strict(),
  recordRefund: z.object({ paymentId: ident, amountPaisa: positive, method: method.optional(), notes: label }).strict(),
  cashMovement: z.object({ kind: z.enum(["expense", "add", "withdrawal", "drop"]), amountPaisa: positive, notes: label }).strict(),
  openShift: z.object({ openingPaisa: money, notes: text.optional() }).strict(),
  closeShift: z.object({ shiftId: ident, countedPaisa: money, notes: text.optional() }).strict(),
  saveStaff: z.object({ id: ident.optional(), email: z.string().trim().email().max(254), name: label, role: z.enum(["manager", "reception"]), active: z.boolean().optional(), permissions: z.array(permission).max(PERMISSIONS.length).optional() }).strict(),
  saveShiftAssignment: z.object({ id: ident.optional(), staffId: ident, startAt: instant, endAt: instant, notes: text.optional() }).strict(),
  saveRatePlan: z.object({ id: ident.optional(), name: label, typeId: ident, basePaisa: positive, weekendPaisa: positive.nullable().optional(), weekendDays: z.array(z.number().int().min(0).max(6)).max(7).optional(), overrides: z.record(date, positive).optional(), active: z.boolean().optional() }).strict(),
  saveSettings: z.object({ name: label, city: text.optional(), checkin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), checkout: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }).strict(),
  saveInvoiceBranding: brandingBaseSchema.partial(),
  issueInvoice: z.object({ reservationId: ident, kind: z.enum(["proforma", "invoice"]), payer: payer.optional(), billTo: z.string().trim().max(2400).optional(), notes: text.optional() }).strict(),
  saveWubook: z.object({ product: z.enum(["unknown", "woodoo", "zak"]), propertyCode: text.optional(), roomMappings: mapping.optional(), rateMappings: mapping.optional(), note: text.optional() }).strict(),
  saveTask: z.object({ id: ident.optional(), roomId: ident, kind: z.enum(["housekeeping", "maintenance"]), title: label, assignedTo: ident.nullable().optional(), status: z.enum(["open", "done"]).optional(), notes: text.optional() }).strict(),
};
const actionPermission: Partial<Record<PmsAction, Permission>> = { saveRoomType: "rooms", archiveRoomType: "rooms", deleteRoomType: "rooms", restoreRoomType: "rooms", saveRoom: "rooms", archiveRoom: "rooms", deleteRoom: "rooms", restoreRoom: "rooms", setRoomStatus: "rooms", saveGuest: "guests", createReservation: "bookings", updateReservation: "bookings", extendReservation: "bookings", setReservationStatus: "bookings", setReservationPrice: "rates", addExtra: "payments", recordPayment: "payments", recordRefund: "refunds", cashMovement: "payments", openShift: "shifts", closeShift: "shifts", saveStaff: "staff", saveShiftAssignment: "staff", saveRatePlan: "rates", saveSettings: "settings", saveInvoiceBranding: "settings", issueInvoice: "payments", saveWubook: "settings", saveTask: "rooms", restoreBackup: "restore" };
export function defaultPermissions(role: Staff["role"]): Permission[] { return role === "owner" ? PERMISSIONS.filter(p => p !== "export") : role === "manager" ? PERMISSIONS.filter(p => !["staff", "restore", "export"].includes(p)) : ["bookings", "guests", "payments", "rooms", "shifts"]; }
export function getMembership(state: PmsState, actor: Actor): Staff {
  const email = actor.email.toLowerCase().trim();
  const member = state.staff.find(s => s.active && (s.userId === actor.userId || (!s.userId && s.email.toLowerCase() === email)));
  if (!member) return fail("You do not have access to this property.", 403);
  return member;
}
export function memberPermissions(member: Staff): Permission[] { return (member.role === "owner" ? defaultPermissions("owner") : member.permissions).filter(p => p !== "export"); }
function assertPermission(member: Staff, action: PmsAction) { const required = actionPermission[action]; if (!required || !memberPermissions(member).includes(required)) fail("Your account cannot perform this action.", 403); if (["saveStaff", "restoreBackup", "saveWubook"].includes(action) && member.role !== "owner") fail("Only the property owner can perform this action.", 403); }
function find<T extends { id: string }>(list: T[], key: string, name: string): T { return list.find(v => v.id === key) ?? fail(`${name} was not found.`, 404); }
function upsert<T extends { id: string }>(list: T[], item: T) { const index = list.findIndex(v => v.id === item.id); if (index < 0) list.push(item); else list[index] = item; }
export function stayDates(arrival: string, departure: string): string[] {
  if (!date.safeParse(arrival).success || !date.safeParse(departure).success || departure <= arrival) fail("Departure must be after arrival.");
  const days = (Date.parse(departure) - Date.parse(arrival)) / 86400000;
  if (days > 730) fail("A stay cannot exceed 730 nights.");
  return Array.from({ length: days }, (_, i) => new Date(Date.parse(arrival) + i * 86400000).toISOString().slice(0, 10));
}
function splitAmount(amount: number, dates: string[]) { const remainder = amount % dates.length; const unit = Math.floor(amount / dates.length); return Object.fromEntries(dates.map((d, i) => [d, unit + (i < remainder ? 1 : 0)])); }
export function quoteStay(state: PmsState, roomId: string | null | undefined, ratePlanId: string | null | undefined, arrival: string, departure: string, roomTypeId?: string) {
  const room = roomId ? find(state.rooms, roomId, "Room") : null;
  if (room?.archived) fail("Restore this room before making a booking.", 409);
  const typeId = room?.typeId ?? roomTypeId;
  if (find(state.roomTypes, typeId ?? "", "Room type").archived) fail("Restore this room type before making a booking.", 409);
  const plan = find(state.ratePlans, ratePlanId ?? "", "Rate plan");
  if (!plan.active || plan.typeId !== typeId) fail("Choose an active rate plan for this room type.");
  const nightlyPricesPaisa = Object.fromEntries(stayDates(arrival, departure).map(d => [d, plan.overrides[d] ?? (plan.weekendDays.includes(new Date(d + "T00:00:00Z").getUTCDay()) && plan.weekendPaisa !== null ? plan.weekendPaisa : plan.basePaisa)]));
  return { nightlyPricesPaisa, roomTotalPaisa: Object.values(nightlyPricesPaisa).reduce((a, b) => a + b, 0) };
}
function blocking(r: Reservation) { return r.status === "reserved" || r.status === "checked_in"; }
function checkCapacity(state: PmsState, candidate: Reservation) {
  if (!blocking(candidate)) return;
  if (find(state.roomTypes, candidate.roomTypeId, "Room type").archived) fail("This room type is archived.", 409);
  const physical = candidate.roomId ? find(state.rooms, candidate.roomId, "Room") : null;
  if (physical && (physical.archived || physical.status === "out_of_service" || physical.typeId !== candidate.roomTypeId)) fail("This room is unavailable or has a different type.", 409);
  const peers = state.reservations.filter(r => r.id !== candidate.id && blocking(r));
  if (physical && peers.some(r => r.roomId === physical.id && r.arrival < candidate.departure && candidate.arrival < r.departure)) fail("This room is already booked for part of the stay.", 409);
  const capacity = state.rooms.filter(r => !r.archived && r.typeId === candidate.roomTypeId && r.status !== "out_of_service").length;
  if (stayDates(candidate.arrival, candidate.departure).some(d => peers.filter(r => r.roomTypeId === candidate.roomTypeId && r.arrival <= d && d < r.departure).length + 1 > capacity)) fail("This room type is sold out for part of the stay.", 409);
}
export function bookingBalance(state: PmsState, reservationId: string) {
  const r = find(state.reservations, reservationId, "Reservation");
  const totalPaisa = r.roomTotalPaisa + r.extras.reduce((a, e) => a + e.amountPaisa, 0);
  const tx = state.transactions.filter(t => t.reservationId === r.id);
  const paidPaisa = tx.reduce((a, t) => a + (t.kind === "payment" ? t.amountPaisa : t.kind === "refund" ? -t.amountPaisa : 0), 0);
  // The booking payer owns room charges; extra services remain guest charges unless the guest ledger is settled.
  const paid = (p: string) => tx.filter(t => t.payer === p).reduce((a, t) => a + (t.kind === "payment" ? t.amountPaisa : t.kind === "refund" ? -t.amountPaisa : 0), 0);
  const roomDue = r.roomTotalPaisa;
  const guestCharges = r.extras.reduce((a, e) => a + e.amountPaisa, 0) + (r.payer === "guest" ? roomDue : 0);
  return { totalPaisa, paidPaisa, balancePaisa: totalPaisa - paidPaisa, guestDuePaisa: guestCharges - paid("guest"), otaDuePaisa: (r.payer === "ota" ? roomDue : 0) - paid("ota"), companyDuePaisa: (r.payer === "company" ? roomDue : 0) - paid("company") };
}
export function expectedCash(state: PmsState, shift: Shift) { return shift.openingPaisa + state.transactions.filter(t => t.shiftId === shift.id && t.method === "cash").reduce((a, t) => a + (["payment", "add"].includes(t.kind) ? t.amountPaisa : -t.amountPaisa), 0); }
function cashier(state: PmsState, member: Staff) { return state.shifts.find(s => s.staffId === member.id && !s.closedAt) ?? fail("Open your cashier shift before recording a transaction.", 409); }
function audit(state: PmsState, actor: Actor, action: string, detail: string, now: string) { state.audit.push({ id: id(), at: now, actor: actor.userId, email: actor.email, action, detail }); }
function queueHousekeeping(state: PmsState, room: Room, now: string) {
  if (room.status !== "out_of_service") room.status = "dirty";
  const matches = state.tasks.filter(t => t.roomId === room.id && t.kind === "housekeeping");
  const task = matches.find(t => t.status === "open") ?? matches.at(-1);
  if (task) { task.status = "open"; if (task.assignedTo && !state.staff.some(s => s.id === task.assignedTo && s.active)) task.assignedTo = null; }
  else state.tasks.push({ id: id(), roomId: room.id, kind: "housekeeping", title: `Clean room ${room.number}`, assignedTo: null, status: "open", notes: "Room requires cleaning after the stay.", createdAt: now });
  for (const duplicate of matches.filter(t => t !== task && t.status === "open")) duplicate.status = "done";
}
function completeHousekeeping(state: PmsState, roomId: string) { for (const task of state.tasks.filter(t => t.roomId === roomId && t.kind === "housekeeping" && t.status === "open")) task.status = "done"; }
export function getInvoiceBranding(state: PmsState): InvoiceBranding {
  return { legalName: state.property.name, address: state.property.city, phone: "", email: "", registrationNumber: "", footer: "", logoDataUrl: "", letterheadDataUrl: "", ...state.property.invoiceBranding };
}
function snapshotInvoiceBranding(state: PmsState): Invoice["branding"] {
  const { logoDataUrl, letterheadDataUrl, ...branding } = getInvoiceBranding(state);
  const asset = (dataUrl: string) => { if (!dataUrl) return null; state.invoiceAssets ??= []; const existing = state.invoiceAssets.find(a => a.dataUrl === dataUrl); if (existing) return existing.id; const assetId = id(); state.invoiceAssets.push({ id: assetId, dataUrl }); return assetId; };
  return { ...branding, logoAssetId: asset(logoDataUrl), letterheadAssetId: asset(letterheadDataUrl) };
}

export function createInitialState(propertyId: string, name: string, city: string, owner: Actor, now = new Date().toISOString(), seedDemo = false): PmsState {
  const state: PmsState = { schemaVersion: 1, property: { id: propertyId, name: label.parse(name), city: text.parse(city), currency: "PKR", timezone: "Asia/Karachi", checkin: "14:00", checkout: "12:00" }, roomTypes: [], rooms: [], guests: [], reservations: [], transactions: [], staff: [{ id: id(), userId: owner.userId, email: owner.email.toLowerCase().trim(), name: owner.name, role: "owner", active: true, permissions: defaultPermissions("owner") }], shiftAssignments: [], shifts: [], ratePlans: [], tasks: [], audit: [], wubook: { product: "unknown", propertyCode: "", roomMappings: [], rateMappings: [], status: "not_connected", lastSync: null, note: "Configuration only. Live connection has not been enabled." } };
  if (seedDemo) {
    const typeId = id(); state.roomTypes.push({ id: typeId, name: "Standard" });
    for (const number of ["101", "102", "103", "104"]) state.rooms.push({ id: id(), number, typeId, status: "clean", notes: "" });
    state.ratePlans.push({ id: id(), name: "Standard flexible", typeId, basePaisa: 650000, weekendPaisa: 750000, weekendDays: [5, 6], overrides: {}, active: true });
  }
  audit(state, owner, "createProperty", seedDemo ? "Property created with explicit sample rooms and a rate plan." : "Empty property created.", now); return state;
}

function parsed<A extends keyof typeof schemas>(action: A, payload: unknown): z.infer<(typeof schemas)[A]> { const result = schemas[action].safeParse(payload); if (!result.success) return fail(result.error.issues.map(e => `${e.path.join(".") || "Payload"}: ${e.message}`).slice(0, 3).join("; ")); return result.data as z.infer<(typeof schemas)[A]>; }

export function applyPmsAction(current: PmsState, action: PmsAction, payload: unknown, actor: Actor, now = new Date().toISOString()): PmsState {
  if (action === "exportBackup") fail("Backup downloads are no longer available.", 410);
  const state = structuredClone(current); const member = getMembership(state, actor); assertPermission(member, action); member.userId ??= actor.userId;
  let detail = "";
  switch (action) {
    case "saveRoomType": { const p = parsed(action, payload); const old = p.id ? find(state.roomTypes, p.id, "Room type") : null; if (old?.archived) fail("Restore this room type before editing it.", 409); if (state.roomTypes.some(t => !t.archived && t.id !== p.id && t.name.toLowerCase() === p.name.toLowerCase())) fail("Room type name already exists."); upsert(state.roomTypes, { ...old, id: p.id ?? id(), name: p.name }); detail = p.name; break; }
    case "archiveRoomType": case "deleteRoomType": { const p = parsed(action, payload); const type = find(state.roomTypes, p.id, "Room type"); if (type.archived) fail("This room type is already archived.", 409); if (state.rooms.some(r => r.typeId === type.id && !r.archived) || state.ratePlans.some(r => r.typeId === type.id && r.active) || state.reservations.some(r => r.roomTypeId === type.id && blocking(r))) fail("Archive its rooms, deactivate its rate plans, and resolve active bookings first.", 409); type.archived = true; detail = `${type.name}: archived; historical records retained`; break; }
    case "restoreRoomType": { const p = parsed(action, payload); const type = find(state.roomTypes, p.id, "Room type"); if (!type.archived) fail("This room type is already active.", 409); if (state.roomTypes.some(t => t.id !== type.id && !t.archived && t.name.toLowerCase() === type.name.toLowerCase())) fail("An active room type already uses this name.", 409); type.archived = false; detail = `${type.name}: restored`; break; }
    case "saveRoom": { const p = parsed(action, payload); const type = find(state.roomTypes, p.typeId, "Room type"); if (type.archived) fail("Choose an active room type.", 409); const old = p.id ? find(state.rooms, p.id, "Room") : null; if (old?.archived) fail("Restore this room before editing it.", 409); if (state.rooms.some(r => !r.archived && r.id !== p.id && r.number.toLowerCase() === p.number.toLowerCase())) fail("Room number already exists."); if (old && old.typeId !== p.typeId && state.reservations.some(r => r.roomId === old.id)) fail("A room with booking history cannot change its room type.", 409); const room: Room = { ...old, id: p.id ?? id(), number: p.number, typeId: p.typeId, status: p.status ?? old?.status ?? "clean", notes: p.notes ?? old?.notes ?? "" }; upsert(state.rooms, room); if (p.status === "clean") completeHousekeeping(state, room.id); else if (p.status === "dirty") queueHousekeeping(state, room, now); detail = p.number; break; }
    case "archiveRoom": case "deleteRoom": { const p = parsed(action, payload); const room = find(state.rooms, p.id, "Room"); if (room.archived) fail("This room is already archived.", 409); if (state.reservations.some(r => r.roomId === room.id && blocking(r))) fail("Move or resolve this room's active bookings before removing it.", 409); room.archived = true; detail = `Room ${room.number}: archived; historical records retained`; break; }
    case "restoreRoom": { const p = parsed(action, payload); const room = find(state.rooms, p.id, "Room"); if (!room.archived) fail("This room is already active.", 409); if (find(state.roomTypes, room.typeId, "Room type").archived) fail("Restore the room type first.", 409); if (state.rooms.some(r => r.id !== room.id && !r.archived && r.number.toLowerCase() === room.number.toLowerCase())) fail("An active room already uses this number.", 409); room.archived = false; detail = `Room ${room.number}: restored`; break; }
    case "setRoomStatus": { const p = parsed(action, payload); const room = find(state.rooms, p.id, "Room"); if (room.archived) fail("Restore this room before changing readiness.", 409); room.status = p.status; if (p.status === "clean") completeHousekeeping(state, room.id); else if (p.status === "dirty") queueHousekeeping(state, room, now); detail = `${room.number}: ${p.status}; housekeeping synchronized`; break; }
    case "saveGuest": { const p = parsed(action, payload); const old = p.id ? find(state.guests, p.id, "Guest") : null; upsert(state.guests, { id: p.id ?? id(), name: p.name, phone: p.phone ?? old?.phone ?? "", document: p.document ?? old?.document ?? "", notes: p.notes ?? old?.notes ?? "" }); detail = "Guest record saved."; break; }
    case "createReservation": {
      const p = parsed(action, payload); const dates = stayDates(p.arrival, p.departure); const room = p.roomId ? find(state.rooms, p.roomId, "Room") : null; const typeId = room?.typeId ?? p.roomTypeId ?? fail("Choose a room or room type."); if (find(state.roomTypes, typeId, "Room type").archived || room?.archived) fail("Choose an active room and room type.", 409);
      if (p.payer === "company" && !p.companyName?.trim()) fail("Enter the company name for a corporate booking.");
      if (p.payer !== "company" && (p.companyName?.trim() || p.companyAddress?.trim())) fail("Company details are only available for company-paid bookings.");
      if (room && p.roomTypeId && p.roomTypeId !== room.typeId) fail("Room and room type do not match.");
      let guestId = p.guestId; if (guestId) find(state.guests, guestId, "Guest"); else { if (!p.guest) fail("Guest details are required."); guestId = id(); state.guests.push({ id: guestId, name: p.guest!.name, phone: p.guest!.phone ?? "", document: p.guest!.document ?? "", notes: p.guest!.notes ?? "" }); }
      const quote = p.roomTotalPaisa !== undefined ? { roomTotalPaisa: p.roomTotalPaisa, nightlyPricesPaisa: splitAmount(p.roomTotalPaisa, dates) } : quoteStay(state, room?.id, p.ratePlanId, p.arrival, p.departure, typeId);
      let overrideDetail = "";
      if (p.ratePlanId) { const plan = find(state.ratePlans, p.ratePlanId, "Rate plan"); if (!plan.active || plan.typeId !== typeId) fail("Rate plan does not match this room type."); const planned = quoteStay(state, room?.id, p.ratePlanId, p.arrival, p.departure, typeId); if (p.roomTotalPaisa !== undefined && p.roomTotalPaisa !== planned.roomTotalPaisa) { if (member.role === "reception" || !memberPermissions(member).includes("rates")) fail("A manager with pricing permission must approve a rate-plan quote override.", 403); if (!p.priceOverrideReason?.trim()) fail("Explain the quoted-price override."); overrideDetail = `; plan override ${planned.roomTotalPaisa} → ${p.roomTotalPaisa} paisa: ${p.priceOverrideReason}`; } }
      const r: Reservation = { id: id(), reference: generateBookingReference(state.reservations.map(reservation => reservation.reference)), guestId, roomId: room?.id ?? null, roomTypeId: typeId, arrival: p.arrival, departure: p.departure, status: "reserved", source: p.source ?? "Direct", sourceReference: p.sourceReference ?? "", payer: p.payer ?? "guest", ...(p.payer === "company" ? { companyName: p.companyName, companyAddress: p.companyAddress ?? "" } : {}), otaPaymentVerified: false, ratePlanId: p.ratePlanId ?? null, ...quote, extras: [], dueDate: p.dueDate ?? p.departure, notes: p.notes ?? "", createdAt: now, createdBy: actor.userId };
      checkCapacity(state, r); state.reservations.push(r); detail = r.reference + overrideDetail; break;
    }
    case "updateReservation": {
      const p = parsed(action, payload); const r = find(state.reservations, p.id, "Reservation"); if (!blocking(r)) fail("Only active reservations can be moved or extended.", 409);
      if (p.departure && p.departure > r.departure) fail("Use Extend stay to confirm the additional charge for extra nights.");
      if (p.companyName !== undefined || p.companyAddress !== undefined) { if (r.payer !== "company") fail("Company details are only available for company-paid bookings."); if (p.companyName !== undefined && !p.companyName.trim()) fail("Enter the company name."); r.companyName = p.companyName ?? r.companyName; r.companyAddress = p.companyAddress ?? r.companyAddress; }
      const oldRoomId = r.roomId; const oldArrival = r.arrival; const oldDeparture = r.departure; if (p.roomId !== undefined) r.roomId = p.roomId;
      if (r.roomId) r.roomTypeId = find(state.rooms, r.roomId, "Room").typeId; else if (p.roomTypeId) r.roomTypeId = find(state.roomTypes, p.roomTypeId, "Room type").id;
      if (r.status === "checked_in" && !r.roomId) fail("Checked-in guests must have a room.");
      if (r.status === "checked_in" && r.roomId !== oldRoomId && find(state.rooms, r.roomId!, "Room").status !== "clean") fail("The destination room must be clean.", 409);
      r.arrival = p.arrival ?? r.arrival; r.departure = p.departure ?? r.departure; const dates = stayDates(r.arrival, r.departure);
      // Editing a stay preserves its agreed total without consulting current sale
      // prices. Changed dates redistribute that total; unchanged dates retain the
      // exact quoted breakdown. Only setReservationPrice changes the agreed charge.
      if (r.ratePlanId && find(state.ratePlans, r.ratePlanId, "Rate plan").typeId !== r.roomTypeId) r.ratePlanId = null;
      if (r.arrival !== oldArrival || r.departure !== oldDeparture) r.nightlyPricesPaisa = splitAmount(r.roomTotalPaisa, dates);
      r.dueDate = p.dueDate ?? r.dueDate; r.notes = p.notes ?? r.notes; checkCapacity(state, r); if (oldRoomId && oldRoomId !== r.roomId && r.status === "checked_in") queueHousekeeping(state, find(state.rooms, oldRoomId, "Room"), now); detail = `${r.reference}: room/dates/company details updated; quote ${r.roomTotalPaisa} paisa`; break;
    }
    case "extendReservation": { const p = parsed(action, payload); const r = find(state.reservations, p.id, "Reservation"); if (!blocking(r)) fail("Only reserved or checked-in bookings can be extended.", 409); if (p.departure <= r.departure) fail("The new departure must be later than the existing departure."); stayDates(r.arrival, p.departure); const previousDeparture = r.departure; const previousTotal = r.roomTotalPaisa; const nextTotal = previousTotal + p.additionalPaisa; if (!money.safeParse(nextTotal).success) fail("The extended room charge exceeds the supported amount."); r.nightlyPricesPaisa = { ...r.nightlyPricesPaisa, ...splitAmount(p.additionalPaisa, stayDates(previousDeparture, p.departure)) }; r.departure = p.departure; r.roomTotalPaisa = nextTotal; if (r.dueDate === previousDeparture) r.dueDate = p.departure; checkCapacity(state, r); detail = `${r.reference}: extended ${previousDeparture} → ${p.departure}; additional ${p.additionalPaisa} paisa; total ${previousTotal} → ${nextTotal}${p.reason ? `; ${p.reason}` : ""}`; break; }
    case "setReservationStatus": {
      const p = parsed(action, payload); const r = find(state.reservations, p.id, "Reservation"); if (r.status === p.status) fail("The booking already has this status.");
      const transitions: Record<string, string[]> = { reserved: ["checked_in", "cancelled", "no_show"], checked_in: ["checked_out"], checked_out: [], cancelled: [], no_show: [] }; if (!transitions[r.status].includes(p.status)) fail("This booking status transition is not allowed.", 409);
      if (["cancelled", "no_show"].includes(p.status) && !p.reason?.trim()) fail("A cancellation/no-show reason is required.");
      if (p.status === "checked_in") { if (!r.roomId) fail("Assign a room before check-in."); if (find(state.rooms, r.roomId!, "Room").status !== "clean") fail("The room must be clean before check-in.", 409); }
      r.status = p.status; if (p.status === "checked_out" && r.roomId) queueHousekeeping(state, find(state.rooms, r.roomId, "Room"), now); detail = `${r.reference}: ${p.status}${p.reason ? ` — ${p.reason}` : ""}; bill and payment history retained${p.status === "checked_out" ? "; housekeeping queued" : ""}`; break;
    }
    case "setReservationPrice": { const p = parsed(action, payload); if (member.role === "reception") fail("A manager must approve booking price corrections.", 403); const r = find(state.reservations, p.id, "Reservation"); const previous = r.roomTotalPaisa; r.roomTotalPaisa = p.amountPaisa; r.nightlyPricesPaisa = splitAmount(p.amountPaisa, stayDates(r.arrival, r.departure)); detail = `${r.reference}: ${previous} → ${p.amountPaisa} paisa; ${p.reason}`; break; }
    case "addExtra": { const p = parsed(action, payload); const r = find(state.reservations, p.id, "Reservation"); r.extras.push({ id: id(), description: p.description, amountPaisa: p.amountPaisa, createdAt: now, createdBy: actor.userId }); detail = `${r.reference}: ${p.description} ${p.amountPaisa} paisa`; break; }
    case "recordPayment": {
      const p = parsed(action, payload); const r = find(state.reservations, p.reservationId, "Reservation"); const shift = cashier(state, member); const paymentPayer = p.payer ?? r.payer;
      if (p.method === "ota" && (paymentPayer !== "ota" || !p.notes?.trim())) fail("OTA settlement needs OTA payer and a settlement/reference note.");
      const balance = bookingBalance(state, r.id); const due = paymentPayer === "ota" ? balance.otaDuePaisa : paymentPayer === "company" ? balance.companyDuePaisa : balance.guestDuePaisa;
      if (p.amountPaisa > due) fail("The payment exceeds this payer's remaining balance.");
      state.transactions.push({ id: id(), receipt: `RC-${String(state.transactions.length + 1).padStart(6, "0")}`, reservationId: r.id, paymentId: null, kind: "payment", amountPaisa: p.amountPaisa, method: p.method, payer: paymentPayer, shiftId: shift.id, notes: p.notes ?? "", createdAt: now, createdBy: actor.userId }); if (paymentPayer === "ota") r.otaPaymentVerified = true; detail = `${r.reference}: ${p.amountPaisa} paisa via ${p.method}, payer ${paymentPayer}`; break;
    }
    case "recordRefund": { const p = parsed(action, payload); const original = find(state.transactions, p.paymentId, "Payment"); if (original.kind !== "payment") fail("Refund must reference an original payment."); const already = state.transactions.filter(t => t.kind === "refund" && t.paymentId === original.id).reduce((a, t) => a + t.amountPaisa, 0); if (already + p.amountPaisa > original.amountPaisa) fail("Refund exceeds the unrefunded payment."); const shift = cashier(state, member); const selectedMethod = p.method ?? original.method; if (selectedMethod !== original.method) fail("Refund must use the original payment method."); if (selectedMethod === "cash" && p.amountPaisa > expectedCash(state, shift)) fail("Add sufficient cash to the drawer before this refund."); state.transactions.push({ id: id(), receipt: `RF-${String(state.transactions.length + 1).padStart(6, "0")}`, reservationId: original.reservationId, paymentId: original.id, kind: "refund", amountPaisa: p.amountPaisa, method: selectedMethod, payer: original.payer, shiftId: shift.id, notes: p.notes, createdAt: now, createdBy: actor.userId }); detail = `Refund ${p.amountPaisa} paisa against ${original.receipt}; ${p.notes}`; break; }
    case "cashMovement": { const p = parsed(action, payload); const shift = cashier(state, member); state.transactions.push({ id: id(), receipt: `CS-${String(state.transactions.length + 1).padStart(6, "0")}`, reservationId: null, paymentId: null, kind: p.kind, amountPaisa: p.amountPaisa, method: "cash", payer: "guest", shiftId: shift.id, notes: p.notes, createdAt: now, createdBy: actor.userId }); if (expectedCash(state, shift) < 0) fail("This cash movement exceeds expected cash."); detail = `${p.kind}: ${p.amountPaisa} paisa; ${p.notes}`; break; }
    case "openShift": { const p = parsed(action, payload); if (state.shifts.some(s => !s.closedAt)) fail("Close the active property drawer before opening another shift.", 409); state.shifts.push({ id: id(), staffId: member.id, openedAt: now, closedAt: null, openingPaisa: p.openingPaisa, countedPaisa: null, expectedPaisa: null, variancePaisa: null, notes: p.notes ?? "" }); detail = `${member.name}: opening ${p.openingPaisa} paisa`; break; }
    case "closeShift": { const p = parsed(action, payload); const s = find(state.shifts, p.shiftId, "Shift"); if (s.closedAt) fail("A closed shift cannot be changed.", 409); if (s.staffId !== member.id && member.role === "reception") fail("You can only close your own shift.", 403); const expected = expectedCash(state, s); if (p.countedPaisa !== expected && !p.notes?.trim()) fail("Explain the cash shortage or overage."); if (Date.parse(now) < Date.parse(s.openedAt)) fail("Closing time cannot precede opening time."); s.closedAt = now; s.countedPaisa = p.countedPaisa; s.expectedPaisa = expected; s.variancePaisa = p.countedPaisa - expected; s.notes = [s.notes, p.notes].filter(Boolean).join("\n"); detail = `Shift ${s.id}: expected ${expected}, counted ${p.countedPaisa}, variance ${s.variancePaisa} paisa`; break; }
    case "saveStaff": { const p = parsed(action, payload); if (p.permissions?.includes("export")) fail("Backup export permission can no longer be granted."); const old = p.id ? find(state.staff, p.id, "Staff member") : null; if (!old && state.staff.length >= 50) fail("The initial version supports up to 50 staff accounts per property."); if (old?.role === "owner") fail("The property owner's membership cannot be changed."); const email = p.email.toLowerCase(); if (state.staff.some(s => s.id !== p.id && s.email === email)) fail("This email already has a staff account."); if (old?.userId && old.email !== email) fail("Deactivate this account and add the new email separately."); if (p.active === false && state.shifts.some(s => s.staffId === old?.id && !s.closedAt)) fail("Close this staff member's drawer before deactivation."); upsert(state.staff, { id: p.id ?? id(), userId: old?.userId, email, name: p.name, role: p.role, active: p.active ?? old?.active ?? true, permissions: [...new Set(p.permissions ?? defaultPermissions(p.role))] }); detail = `${email}: ${p.role}, active ${p.active ?? true}`; break; }
    case "saveShiftAssignment": { const p = parsed(action, payload); if (p.id) find(state.shiftAssignments, p.id, "Shift assignment"); const staff = find(state.staff, p.staffId, "Staff member"); if (!staff.active || Date.parse(p.endAt) <= Date.parse(p.startAt)) fail("Choose active staff and a valid shift time range."); if (state.shiftAssignments.some(s => s.id !== p.id && s.staffId === p.staffId && Date.parse(s.startAt) < Date.parse(p.endAt) && Date.parse(p.startAt) < Date.parse(s.endAt))) fail("This staff member already has an overlapping assignment.", 409); upsert(state.shiftAssignments, { id: p.id ?? id(), staffId: p.staffId, startAt: p.startAt, endAt: p.endAt, notes: p.notes ?? "" }); detail = `${staff.name}: ${p.startAt} → ${p.endAt}`; break; }
    case "saveRatePlan": { const p = parsed(action, payload); if (p.id) find(state.ratePlans, p.id, "Rate plan"); if (find(state.roomTypes, p.typeId, "Room type").archived) fail("Restore the room type before changing its rate plans.", 409); const old = p.id ? find(state.ratePlans, p.id, "Rate plan") : null; if (old && old.typeId !== p.typeId && state.reservations.some(r => r.ratePlanId === old.id)) fail("A rate plan used by bookings cannot change room type."); upsert(state.ratePlans, { id: p.id ?? id(), name: p.name, typeId: p.typeId, basePaisa: p.basePaisa, weekendPaisa: p.weekendPaisa ?? null, weekendDays: [...new Set(p.weekendDays ?? [5, 6])], overrides: p.overrides ?? {}, active: p.active ?? true }); detail = `${p.name}: base ${p.basePaisa}; confirmed booking quotes preserved`; break; }
    case "saveSettings": { const p = parsed(action, payload); state.property.name = p.name; state.property.city = p.city ?? state.property.city; state.property.checkin = p.checkin ?? state.property.checkin; state.property.checkout = p.checkout ?? state.property.checkout; detail = "Property settings saved."; break; }
    case "saveInvoiceBranding": { const p = parsed(action, payload); const candidate = { ...getInvoiceBranding(state), ...p }; const result = brandingSchema.safeParse(candidate); if (!result.success) fail(result.error.issues.map(i => i.message).join(" ")); state.property.invoiceBranding = result.data; detail = "Invoice branding updated; previously issued documents retain their branding."; break; }
    case "issueInvoice": {
      const p = parsed(action, payload); const r = find(state.reservations, p.reservationId, "Reservation"); const guest = find(state.guests, r.guestId, "Guest"); const scope = p.payer ?? r.payer;
      const lineItems: Invoice["lineItems"] = [...(scope === r.payer ? stayDates(r.arrival, r.departure).map(day => ({ id: `night:${day}`, description: `Room accommodation · ${day}`, quantity: 1, unitPaisa: r.nightlyPricesPaisa[day], amountPaisa: r.nightlyPricesPaisa[day] })) : []), ...(scope === "guest" ? r.extras.map(extra => ({ id: extra.id, description: extra.description, quantity: 1, unitPaisa: extra.amountPaisa, amountPaisa: extra.amountPaisa })) : [])];
      if (!lineItems.length) fail("This payer has no charges to invoice.");
      const totalPaisa = lineItems.reduce((sum, item) => sum + item.amountPaisa, 0);
      const paidPaisa = state.transactions.filter(t => t.reservationId === r.id && t.payer === scope).reduce((sum, t) => sum + (t.kind === "payment" ? t.amountPaisa : t.kind === "refund" ? -t.amountPaisa : 0), 0);
      const chargeFingerprint = JSON.stringify({ reservationId: r.id, payer: scope, arrival: r.arrival, departure: r.departure, lineItems });
      state.invoices ??= [];
      if (p.kind === "invoice") { const prior = state.invoices.find(i => i.kind === "invoice" && i.reservationId === r.id && i.chargeFingerprint === chargeFingerprint); if (prior) fail(`Invoice ${prior.number} already records these charges. Open the existing invoice.`, 409); }
      const prefix = p.kind === "invoice" ? "INV" : "PF"; const sequence = state.invoices.filter(i => i.kind === p.kind).length + 1; let serial = sequence; let number = `${prefix}-${String(serial).padStart(6, "0")}`; while (state.invoices.some(i => i.number === number)) number = `${prefix}-${String(++serial).padStart(6, "0")}`;
      const corporateBillTo = [r.companyName || "Company account", r.companyAddress].filter(Boolean).join("\n"); const defaultBillTo = scope === "company" ? corporateBillTo : scope === "ota" ? `OTA account${r.source ? ` · ${r.source}` : ""}${r.sourceReference ? ` · ${r.sourceReference}` : ""}` : guest.name;
      const invoice: Invoice = { id: id(), kind: p.kind, payer: scope, number, issuedAt: now, issuedBy: actor.userId, reservationId: r.id, bookingReference: r.reference, guestName: guest.name, guestPhone: guest.phone, companyName: r.companyName ?? "", companyAddress: r.companyAddress ?? "", billTo: p.billTo?.trim() || defaultBillTo, roomNumber: r.roomId ? find(state.rooms, r.roomId, "Room").number : `Unassigned · ${find(state.roomTypes, r.roomTypeId, "Room type").name}`, arrival: r.arrival, departure: r.departure, currency: "PKR", lineItems, roomTotalPaisa: scope === r.payer ? r.roomTotalPaisa : 0, totalPaisa, paidPaisa, balancePaisa: totalPaisa - paidPaisa, dueDate: r.dueDate, branding: snapshotInvoiceBranding(state), notes: p.notes ?? "", chargeFingerprint };
      state.invoices.push(invoice); detail = `${number}: ${p.kind} for ${r.reference}, payer ${scope}; total ${totalPaisa}, paid ${paidPaisa}, due ${invoice.balancePaisa} paisa; immutable snapshot`; break;
    }
    case "saveWubook": { const p = parsed(action, payload); const rooms = p.roomMappings ?? []; const rates = p.rateMappings ?? []; for (const m of rooms) find(state.roomTypes, m.localId, "Room type mapping"); for (const m of rates) find(state.ratePlans, m.localId, "Rate plan mapping"); if (new Set(rooms.map(m => m.localId)).size !== rooms.length || new Set(rates.map(m => m.localId)).size !== rates.length) fail("Mappings must have unique local IDs."); state.wubook = { product: p.product, propertyCode: p.propertyCode ?? "", roomMappings: rooms, rateMappings: rates, status: p.product !== "unknown" && !!p.propertyCode ? "configured" : "not_connected", lastSync: null, note: p.note ?? "Configuration only; no live sync." }; detail = "WuBook configuration saved; no live publication performed."; break; }
    case "saveTask": { const p = parsed(action, payload); const room = find(state.rooms, p.roomId, "Room"); if (p.id) find(state.tasks, p.id, "Task"); if (room.archived && !p.id) fail("Restore this room before adding work.", 409); if (p.assignedTo) { if (!find(state.staff, p.assignedTo, "Staff member").active) fail("Choose an active staff member."); } const old = p.id ? find(state.tasks, p.id, "Task") : null; if (p.kind === "housekeeping" && (p.status ?? "open") === "open" && state.tasks.some(t => t.id !== p.id && t.roomId === p.roomId && t.kind === "housekeeping" && t.status === "open")) fail("This room already has an open housekeeping task. Update that task instead.", 409); upsert(state.tasks, { id: p.id ?? id(), roomId: p.roomId, kind: p.kind, title: p.title, assignedTo: p.assignedTo ?? null, status: p.status ?? "open", notes: p.notes ?? "", createdAt: old?.createdAt ?? now }); if (p.kind === "housekeeping" && p.status === "done") { completeHousekeeping(state, room.id); if (room.status !== "out_of_service") room.status = "clean"; } detail = `${p.title}: ${p.status ?? "open"}; assigned to ${p.assignedTo ? find(state.staff, p.assignedTo, "Staff member").name : "unassigned"}; room ${room.number}`; break; }
    case "restoreBackup": { const p = z.object({ backup: z.unknown(), reason: label }).strict().safeParse(payload); if (!p.success) fail("Provide a valid backup and restore reason."); const restored = validateBackup(p.data.backup); if (restored.property.id !== state.property.id) fail("Backup belongs to a different property.", 403); for (const t of state.transactions) if (JSON.stringify(restored.transactions.find(v => v.id === t.id)) !== JSON.stringify(t)) fail("Restore cannot remove or change existing financial transactions."); for (const s of state.shifts.filter(s => s.closedAt)) if (JSON.stringify(restored.shifts.find(v => v.id === s.id)) !== JSON.stringify(s)) fail("Restore cannot remove or change closed shifts."); for (const invoice of state.invoices ?? []) if (JSON.stringify(restored.invoices?.find(i => i.id === invoice.id)) !== JSON.stringify(invoice)) fail("Restore cannot remove or change issued invoices."); for (const asset of state.invoiceAssets ?? []) if (JSON.stringify(restored.invoiceAssets?.find(a => a.id === asset.id)) !== JSON.stringify(asset)) fail("Restore cannot remove or change historical invoice images."); if (state.shifts.some(s => !s.closedAt) || restored.shifts.some(s => !s.closedAt)) fail("Close all cashier shifts before restore.", 409); const retainedStaff = state.staff; const retainedAudit = state.audit; Object.assign(state, restored); state.staff = retainedStaff; state.audit = retainedAudit; detail = `Backup restored: ${p.data.reason}. Staff access and audit history retained.`; break; }
    default: fail("Unknown action.");
  }
  for (const r of state.reservations) { checkCapacity(state, r); r.otaPaymentVerified = state.transactions.filter(t => t.reservationId === r.id && t.payer === "ota").reduce((a, t) => a + (t.kind === "payment" ? t.amountPaisa : t.kind === "refund" ? -t.amountPaisa : 0), 0) > 0; }
  audit(state, actor, action, detail, now);
  validateBackup(state);
  if (JSON.stringify(state).length > 850000) fail("This property's storage limit has been reached. Reduce new invoice image sizes or contact support. Existing history has been preserved.", 413);
  return state;
}

const backupSchema = z.object({
  schemaVersion: z.literal(1),
  property: z.object({ id: ident, name: label, city: text, currency: z.literal("PKR"), timezone: z.literal("Asia/Karachi"), checkin: z.string(), checkout: z.string(), invoiceBranding: brandingSchema.optional() }).strict(),
  roomTypes: z.array(z.object({ id: ident, name: label, archived: z.boolean().optional() }).strict()),
  rooms: z.array(z.object({ id: ident, number: label, typeId: ident, status: roomStatus, notes: text, archived: z.boolean().optional() }).strict()),
  guests: z.array(z.object({ id: ident, name: label, phone: text, document: text, notes: text }).strict()),
  reservations: z.array(z.object({ id: ident, reference: label, guestId: ident, roomId: ident.nullable(), roomTypeId: ident, arrival: date, departure: date, status: bookingStatus, source: text, sourceReference: text, payer, companyName: text.max(200).optional(), companyAddress: text.optional(), otaPaymentVerified: z.boolean(), ratePlanId: ident.nullable(), roomTotalPaisa: money, nightlyPricesPaisa: z.record(date, money), extras: z.array(z.object({ id: ident, description: label, amountPaisa: positive, createdAt: instant, createdBy: ident }).strict()), dueDate: date, notes: text, createdAt: instant, createdBy: ident }).strict()),
  transactions: z.array(z.object({ id: ident, receipt: label, reservationId: ident.nullable(), paymentId: ident.nullable(), kind: z.enum(["payment", "refund", "expense", "add", "withdrawal", "drop"]), amountPaisa: positive, method, payer, shiftId: ident.nullable(), notes: text, createdAt: instant, createdBy: ident }).strict()),
  staff: z.array(z.object({ id: ident, userId: ident.optional(), email: z.string().email(), name: label, role: z.enum(["owner", "manager", "reception"]), active: z.boolean(), permissions: z.array(permission) }).strict()),
  shiftAssignments: z.array(z.object({ id: ident, staffId: ident, startAt: instant, endAt: instant, notes: text }).strict()),
  shifts: z.array(z.object({ id: ident, staffId: ident, openedAt: instant, closedAt: instant.nullable(), openingPaisa: money, countedPaisa: money.nullable(), expectedPaisa: money.nullable(), variancePaisa: z.number().int().nullable(), notes: text }).strict()),
  ratePlans: z.array(z.object({ id: ident, name: label, typeId: ident, basePaisa: positive, weekendPaisa: positive.nullable(), weekendDays: z.array(z.number().int().min(0).max(6)), overrides: z.record(date, positive), active: z.boolean() }).strict()),
  tasks: z.array(z.object({ id: ident, roomId: ident, kind: z.enum(["housekeeping", "maintenance"]), title: label, assignedTo: ident.nullable(), status: z.enum(["open", "done"]), notes: text, createdAt: instant }).strict()),
  audit: z.array(z.object({ id: ident, at: instant, actor: ident, email: z.string(), action: z.string(), detail: text }).strict()),
  wubook: z.object({ product: z.enum(["unknown", "woodoo", "zak"]), propertyCode: text, roomMappings: mapping, rateMappings: mapping, status: z.enum(["not_connected", "configured"]), lastSync: z.null(), note: text }).strict(),
  invoices: z.array(invoiceSchema).optional(),
  invoiceAssets: z.array(z.object({ id: ident, dataUrl: imageDataUrl.refine(Boolean, "Invoice assets must contain an image.") }).strict()).optional(),
}).strict();

export function validateBackup(value: unknown): PmsState {
  const result = backupSchema.safeParse(value); if (!result.success) return fail("Backup format is invalid. Export a complete version 1 property backup."); const s = result.data as PmsState;
  for (const rows of [s.roomTypes, s.rooms, s.guests, s.reservations, s.transactions, s.staff, s.shiftAssignments, s.shifts, s.ratePlans, s.tasks, s.invoices ?? [], s.invoiceAssets ?? []]) if (new Set(rows.map(r => r.id)).size !== rows.length) fail("Backup contains duplicate IDs.");
  if (new Set(s.transactions.map(t => t.receipt)).size !== s.transactions.length) fail("Backup contains duplicate receipt numbers.");
  const liveRooms = s.rooms.filter(r => !r.archived); const liveTypes = s.roomTypes.filter(t => !t.archived);
  if (new Set(liveRooms.map(r => r.number.toLowerCase())).size !== liveRooms.length || new Set(liveTypes.map(t => t.name.toLowerCase())).size !== liveTypes.length) fail("Active rooms and room types must have unique names or numbers.");
  for (const room of s.rooms) { const type = find(s.roomTypes, room.typeId, "Backup room type"); if (!room.archived && type.archived) fail("An active room cannot belong to an archived type."); }
  for (const plan of s.ratePlans) { const type = find(s.roomTypes, plan.typeId, "Backup rate-plan room type"); if (plan.active && type.archived) fail("An active rate plan cannot belong to an archived room type."); }
  for (const r of s.reservations) { find(s.guests, r.guestId, "Backup guest"); find(s.roomTypes, r.roomTypeId, "Backup room type"); if (r.roomId) { const room = find(s.rooms, r.roomId, "Backup room"); if (room.typeId !== r.roomTypeId) fail("Backup reservation has mismatched room type."); } if (r.ratePlanId) find(s.ratePlans, r.ratePlanId, "Backup rate plan"); const days = stayDates(r.arrival, r.departure); if (days.length !== Object.keys(r.nightlyPricesPaisa).length || days.some(d => r.nightlyPricesPaisa[d] === undefined) || Object.values(r.nightlyPricesPaisa).reduce((a, b) => a + b, 0) !== r.roomTotalPaisa) fail("Backup booking quote is inconsistent."); checkCapacity(s, r); }
  for (const t of s.transactions) { if (t.reservationId) find(s.reservations, t.reservationId, "Backup transaction booking"); if (!t.shiftId) fail("Backup transaction must have a shift."); find(s.shifts, t.shiftId, "Backup transaction shift"); if (t.kind === "payment" && !t.reservationId) fail("Backup payment requires a booking."); if (t.kind === "refund") { const payment = find(s.transactions, t.paymentId ?? "", "Backup original payment"); if (payment.kind !== "payment" || payment.reservationId !== t.reservationId || payment.payer !== t.payer || payment.method !== t.method) fail("Backup refund references an invalid payment."); if (s.transactions.filter(v => v.kind === "refund" && v.paymentId === payment.id).reduce((a, v) => a + v.amountPaisa, 0) > payment.amountPaisa) fail("Backup refund exceeds payment."); } }
  for (const shift of s.shifts) { find(s.staff, shift.staffId, "Backup shift staff"); if (shift.closedAt && (Date.parse(shift.closedAt) < Date.parse(shift.openedAt) || shift.expectedPaisa !== expectedCash(s, shift) || shift.countedPaisa === null || shift.variancePaisa !== shift.countedPaisa - shift.expectedPaisa)) fail("Backup closed shift is inconsistent."); }
  if (s.shifts.filter(s => !s.closedAt).length > 1) fail("Backup has multiple active drawers.");
  for (const a of s.shiftAssignments) { find(s.staff, a.staffId, "Backup assigned staff"); if (Date.parse(a.endAt) <= Date.parse(a.startAt)) fail("Backup shift assignment is invalid."); }
  for (const task of s.tasks) { find(s.rooms, task.roomId, "Backup task room"); if (task.assignedTo) find(s.staff, task.assignedTo, "Backup task staff"); }
  for (const m of s.wubook.roomMappings) find(s.roomTypes, m.localId, "Backup room mapping"); for (const m of s.wubook.rateMappings) find(s.ratePlans, m.localId, "Backup rate mapping");
  const invoices = s.invoices ?? [];
  if (new Set(invoices.map(i => i.number)).size !== invoices.length) fail("Invoice numbers must be unique.");
  for (const invoice of invoices) {
    find(s.reservations, invoice.reservationId, "Invoice booking"); stayDates(invoice.arrival, invoice.departure);
    if (new Set(invoice.lineItems.map(i => i.id)).size !== invoice.lineItems.length || invoice.lineItems.some(i => i.quantity * i.unitPaisa !== i.amountPaisa) || invoice.lineItems.reduce((a, i) => a + i.amountPaisa, 0) !== invoice.totalPaisa || invoice.lineItems.filter(i => i.id.startsWith("night:")).reduce((a, i) => a + i.amountPaisa, 0) !== invoice.roomTotalPaisa || invoice.balancePaisa !== invoice.totalPaisa - invoice.paidPaisa) fail("Invoice snapshot amounts are inconsistent.");
    if (invoice.chargeFingerprint !== JSON.stringify({ reservationId: invoice.reservationId, payer: invoice.payer, arrival: invoice.arrival, departure: invoice.departure, lineItems: invoice.lineItems })) fail("Invoice charge snapshot is inconsistent.");
    for (const assetId of [invoice.branding.logoAssetId, invoice.branding.letterheadAssetId]) if (assetId) find(s.invoiceAssets ?? [], assetId, "Invoice branding image");
  }
  return s;
}
