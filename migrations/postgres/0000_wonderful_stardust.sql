CREATE TABLE "pms_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pms_properties" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"state_json" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"mutation_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "pms_version_nonnegative" CHECK ("pms_properties"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pms_memberships" ADD CONSTRAINT "pms_memberships_property_id_pms_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."pms_properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pms_membership_email_idx" ON "pms_memberships" USING btree ("email","active");--> statement-breakpoint
CREATE INDEX "pms_membership_user_idx" ON "pms_memberships" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "pms_membership_property_idx" ON "pms_memberships" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pms_membership_staff_unique" ON "pms_memberships" USING btree ("property_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pms_membership_email_unique" ON "pms_memberships" USING btree ("property_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "pms_membership_principal_unique" ON "pms_memberships" USING btree ("property_id","user_id") WHERE "pms_memberships"."active" = true AND "pms_memberships"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pms_owner_idx" ON "pms_properties" USING btree ("owner_user_id");