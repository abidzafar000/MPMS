import { env } from "cloudflare:workers";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "../db";
import { memberships, properties } from "../db/schema";
import { applyPmsAction, createInitialState, getMembership, memberPermissions, PmsError } from "./pms-engine";
import type { Actor, PmsAction, PmsResponse, PmsState, Role } from "./pms-types";

export function filterState(state: PmsState, actor: Actor): PmsState {
  const member = getMembership(state, actor); const permissions = memberPermissions(member); const copy = structuredClone(state);
  // Guest identity documents and private notes require explicit guest-record
  // access, including when other record categories may be exported.
  if (!permissions.includes("guests")) copy.guests = copy.guests.map(guest => ({ ...guest, document: "", notes: "" }));
  if (!permissions.includes("guests") && !permissions.includes("bookings") && !permissions.includes("payments")) copy.guests = [];
  if (!permissions.includes("bookings") && !permissions.includes("payments") && !permissions.includes("reports")) copy.reservations = [];
  if (!permissions.includes("payments") && !permissions.includes("reports") && !permissions.includes("refunds")) { copy.transactions = copy.transactions.filter(t => t.createdBy === actor.userId); copy.reservations = copy.reservations.map(r => ({ ...r, roomTotalPaisa: 0, nightlyPricesPaisa: {}, extras: [] })); }
  if (!permissions.includes("payments") && !permissions.includes("reports")) { copy.invoices = []; copy.invoiceAssets = []; }
  copy.staff = copy.staff.map(s => ({ ...s, permissions: s.permissions.filter(p => p !== "export") }));
  if (!permissions.includes("reports") && !permissions.includes("staff")) { copy.shifts = copy.shifts.filter(s => s.staffId === member.id); copy.shiftAssignments = copy.shiftAssignments.filter(s => s.staffId === member.id); }
  if (!permissions.includes("staff") && member.role !== "owner") copy.staff = copy.staff.map(s => ({ id: s.id, email: s.id === member.id ? s.email : "", name: s.name, role: s.role, active: s.active, permissions: s.id === member.id ? s.permissions : [] }));
  if (!permissions.includes("settings")) copy.wubook = { product: "unknown", propertyCode: "", roomMappings: [], rateMappings: [], status: "not_connected", lastSync: null, note: "" };
  if (!permissions.includes("reports") && member.role !== "owner") copy.audit = copy.audit.filter(a => a.actor === actor.userId);
  return copy;
}

export async function readPms(actor: Actor, propertyId?: string): Promise<PmsResponse> {
  const db = getDb();
  const indexed = await db.select({ propertyId: memberships.propertyId }).from(memberships).where(and(eq(memberships.active, true), or(eq(memberships.userId, actor.userId), eq(memberships.email, actor.email.toLowerCase().trim()))));
  const list: PmsResponse["properties"] = [];
  let selected: typeof properties.$inferSelect | undefined;
  // Index is for discovery only: current membership inside every property is authoritative.
  for (const key of [...new Set(indexed.map(i => i.propertyId))]) {
    const row = await db.select().from(properties).where(eq(properties.id, key)).get(); if (!row) continue;
    const state = JSON.parse(row.stateJson) as PmsState;
    try { const member = getMembership(state, actor); list.push({ id: row.id, name: row.name, role: member.role }); if (row.id === propertyId || (!propertyId && !selected)) selected = row; } catch (error) { if (!(error instanceof PmsError && error.status === 403)) throw error; }
  }
  if (propertyId && !selected) throw new PmsError(403, "You do not have access to this property.");
  const state = selected ? JSON.parse(selected.stateJson) as PmsState : null; const member = state ? getMembership(state, actor) : null;
  return { user: { userId: actor.userId, email: actor.email, displayName: actor.name }, properties: list, state: state ? filterState(state, actor) : null, version: selected?.version ?? null, role: member?.role as Role | null ?? null, permissions: member ? memberPermissions(member) : [] };
}

export async function createProperty(actor: Actor, payload: { name: string; city?: string; seedDemo?: boolean }): Promise<PmsResponse> {
  const db = getDb(); const existing = await db.select({ id: properties.id }).from(properties).where(eq(properties.ownerUserId, actor.userId));
  if (existing.length >= 20) throw new PmsError(400, "You can create up to 20 properties in this initial version.");
  const propertyId = crypto.randomUUID(); const now = new Date().toISOString(); const state = createInitialState(propertyId, payload.name, payload.city ?? "", actor, now, payload.seedDemo ?? false);
  const staff = state.staff[0];
  await db.batch([
    db.insert(properties).values({ id: propertyId, ownerUserId: actor.userId, name: state.property.name, stateJson: JSON.stringify(state), version: 0, mutationId: crypto.randomUUID(), createdAt: now, updatedAt: now }),
    db.insert(memberships).values({ id: `${propertyId}:${staff.id}`, propertyId, staffId: staff.id, email: staff.email, userId: actor.userId, role: "owner", active: true }),
  ]);
  return readPms(actor, propertyId);
}

export async function mutatePms(actor: Actor, propertyId: string, version: number, action: PmsAction, payload: unknown): Promise<PmsResponse> {
  const db = getDb(); const d1 = env.DB; if (!d1) throw new PmsError(503, "Property storage is unavailable."); const row = await db.select().from(properties).where(eq(properties.id, propertyId)).get();
  if (!row) throw new PmsError(403, "You do not have access to this property.");
  const current = JSON.parse(row.stateJson) as PmsState; getMembership(current, actor);
  if (version !== row.version) throw new PmsError(409, "This property changed in another session. Refresh and retry your action.", row.version);
  const next = applyPmsAction(current, action, payload, actor); const mutationId = crypto.randomUUID(); const nextVersion = version + 1;
  // D1 batch is transactional. The mutation ID conditions prevent index changes
  // if another request wins the compare-and-swap with the same expected version.
  const statements = [d1.prepare("UPDATE pms_properties SET state_json = ?, name = ?, version = ?, mutation_id = ?, updated_at = ? WHERE id = ? AND version = ?").bind(JSON.stringify(next), next.property.name, nextVersion, mutationId, new Date().toISOString(), propertyId, version), d1.prepare("DELETE FROM pms_memberships WHERE property_id = ? AND EXISTS (SELECT 1 FROM pms_properties WHERE id = ? AND mutation_id = ?)").bind(propertyId, propertyId, mutationId)];
  for (const staff of next.staff) statements.push(d1.prepare("INSERT INTO pms_memberships (id, property_id, staff_id, email, user_id, role, active) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pms_properties WHERE id = ? AND mutation_id = ?)").bind(`${propertyId}:${staff.id}`, propertyId, staff.id, staff.email, staff.userId ?? null, staff.role, staff.active ? 1 : 0, propertyId, mutationId));
  const results = await d1.batch(statements);
  if (results[0].meta.changes !== 1) { const latest = await db.select({ version: properties.version }).from(properties).where(eq(properties.id, propertyId)).get(); throw new PmsError(409, "Another staff member saved a change first. Refresh and retry your action.", latest?.version); }
  return readPms(actor, propertyId);
}
