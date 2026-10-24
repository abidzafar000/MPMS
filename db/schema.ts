import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

// Retain JSON serialization: current restore checks compare immutable snapshots,
// and jsonb would reorder their keys. Memberships remain a discovery projection.
export const properties = pgTable("pms_properties", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  stateJson: text("state_json").notNull(),
  version: integer("version").notNull().default(0),
  mutationId: text("mutation_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("pms_owner_idx").on(table.ownerUserId), check("pms_version_nonnegative", sql`${table.version} >= 0`)]);

export const memberships = pgTable("pms_memberships", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  staffId: text("staff_id").notNull(),
  email: text("email").notNull(),
  userId: text("user_id"),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
}, table => [
  index("pms_membership_email_idx").on(table.email, table.active),
  index("pms_membership_user_idx").on(table.userId, table.active),
  index("pms_membership_property_idx").on(table.propertyId),
  uniqueIndex("pms_membership_staff_unique").on(table.propertyId, table.staffId),
  uniqueIndex("pms_membership_email_unique").on(table.propertyId, table.email),
  uniqueIndex("pms_membership_principal_unique").on(table.propertyId, table.userId).where(sql`${table.active} = true AND ${table.userId} IS NOT NULL`),
]);
