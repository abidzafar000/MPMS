import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// A versioned property aggregate keeps initial PMS operations atomic. Memberships
// are indexed separately for discovery; authorization always rechecks the aggregate.
export const properties = sqliteTable("pms_properties", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  stateJson: text("state_json").notNull(),
  version: integer("version").notNull().default(0),
  mutationId: text("mutation_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [index("pms_owner_idx").on(table.ownerUserId)]);

export const memberships = sqliteTable("pms_memberships", {
  id: text("id").primaryKey(),
  propertyId: text("property_id").notNull().references(() => properties.id),
  staffId: text("staff_id").notNull(),
  email: text("email").notNull(),
  userId: text("user_id"),
  role: text("role").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, table => [index("pms_membership_email_idx").on(table.email, table.active), index("pms_membership_user_idx").on(table.userId, table.active), index("pms_membership_property_idx").on(table.propertyId)]);
