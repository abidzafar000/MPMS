import { and, eq, inArray, or, sql } from "drizzle-orm";
import { withDb, type PmsDatabase } from "../db";
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
  return withDb(db => readPmsUsing(db, actor, propertyId));
}

async function readPmsUsing(db: PmsDatabase, actor: Actor, propertyId?: string): Promise<PmsResponse> {
  const indexed = await db.select({ propertyId: memberships.propertyId }).from(memberships).where(and(eq(memberships.active, true), or(eq(memberships.userId, actor.userId), eq(memberships.email, actor.email.toLowerCase().trim()))));
  const keys = [...new Set(indexed.map(i => i.propertyId))];
  const rows = keys.length ? await db.select().from(properties).where(inArray(properties.id, keys)).orderBy(properties.createdAt, properties.id) : [];
  const list: PmsResponse["properties"] = [];
  let selected: typeof properties.$inferSelect | undefined;
  // Index is for discovery only: current membership inside every property is authoritative.
  for (const row of rows) {
    const state = JSON.parse(row.stateJson) as PmsState;
    try { const member = getMembership(state, actor); list.push({ id: row.id, name: row.name, role: member.role }); if (row.id === propertyId || (!propertyId && !selected)) selected = row; } catch (error) { if (!(error instanceof PmsError && error.status === 403)) throw error; }
  }
  if (propertyId && !selected) throw new PmsError(403, "You do not have access to this property.");
  const state = selected ? JSON.parse(selected.stateJson) as PmsState : null; const member = state ? getMembership(state, actor) : null;
  return { user: { userId: actor.userId, email: actor.email, displayName: actor.name }, properties: list, state: state ? filterState(state, actor) : null, version: selected?.version ?? null, role: member?.role as Role | null ?? null, permissions: member ? memberPermissions(member) : [] };
}

export async function createProperty(actor: Actor, payload: { name: string; city?: string; seedDemo?: boolean }): Promise<PmsResponse> {
  return withDb(async db => {
    const propertyId = await db.transaction(async tx => {
      // A transaction-scoped advisory lock serializes onboarding by owner, even
      // when no property exists yet, so concurrent requests cannot exceed 20.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"mpms-owner:" + actor.userId}, 0))`);
      const existing = await tx.select({ id: properties.id }).from(properties).where(eq(properties.ownerUserId, actor.userId));
      if (existing.length >= 20) throw new PmsError(400, "You can create up to 20 properties in this initial version.");
      const id = crypto.randomUUID(); const now = new Date().toISOString(); const state = createInitialState(id, payload.name, payload.city ?? "", actor, now, payload.seedDemo ?? false);
      const staff = state.staff[0];
      await tx.insert(properties).values({ id, ownerUserId: actor.userId, name: state.property.name, stateJson: JSON.stringify(state), version: 0, mutationId: crypto.randomUUID(), createdAt: now, updatedAt: now });
      await tx.insert(memberships).values({ id: `${id}:${staff.id}`, propertyId: id, staffId: staff.id, email: staff.email.toLowerCase().trim(), userId: actor.userId, role: "owner", active: true });
      return id;
    });
    return readPmsUsing(db, actor, propertyId);
  });
}

export async function mutatePms(actor: Actor, propertyId: string, version: number, action: PmsAction, payload: unknown): Promise<PmsResponse> {
  return withDb(async db => {
    await db.transaction(async tx => {
      const [row] = await tx.select().from(properties).where(eq(properties.id, propertyId)).limit(1).for("update");
      if (!row) throw new PmsError(403, "You do not have access to this property.");
      // Authorize only after acquiring the row lock: a concurrent deactivation
      // or permission change must be visible before this request can mutate.
      const current = JSON.parse(row.stateJson) as PmsState; getMembership(current, actor);
      if (version !== row.version) throw new PmsError(409, "This property changed in another session. Refresh and retry your action.", row.version);
      const next = applyPmsAction(current, action, payload, actor);
      const saved = await tx.update(properties).set({ stateJson: JSON.stringify(next), name: next.property.name, version: version + 1, mutationId: crypto.randomUUID(), updatedAt: new Date().toISOString() }).where(and(eq(properties.id, propertyId), eq(properties.version, version))).returning({ version: properties.version });
      if (saved.length !== 1) throw new PmsError(409, "Another staff member saved a change first. Refresh and retry your action.", row.version);
      await tx.delete(memberships).where(eq(memberships.propertyId, propertyId));
      await tx.insert(memberships).values(next.staff.map(staff => ({ id: `${propertyId}:${staff.id}`, propertyId, staffId: staff.id, email: staff.email.toLowerCase().trim(), userId: staff.userId ?? null, role: staff.role, active: staff.active })));
    });
    return readPmsUsing(db, actor, propertyId);
  });
}
