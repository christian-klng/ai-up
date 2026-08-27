CREATE TABLE "content_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"change_note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'file-text' NOT NULL,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_key" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_area_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_template_versions" ADD CONSTRAINT "content_template_versions_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_template_versions" ADD CONSTRAINT "content_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_area_templates" ADD CONSTRAINT "knowledge_area_templates_area_id_knowledge_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."knowledge_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_area_templates" ADD CONSTRAINT "knowledge_area_templates_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_template_versions_no_idx" ON "content_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_system_key_idx" ON "content_templates" USING btree ("system_key");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_area_templates_pair_idx" ON "knowledge_area_templates" USING btree ("area_id","template_id");--> statement-breakpoint
CREATE INDEX "knowledge_area_templates_area_idx" ON "knowledge_area_templates" USING btree ("area_id");--> statement-breakpoint
-- Data migration (hand-written): every collection structure becomes a standalone
-- template, keeping its id and version so entry snapshots (meta.structure.structureId)
-- keep resolving. Each structured collection gets its template assigned; collections
-- without a structure get no rows and fall back to the seeded system templates.
INSERT INTO "content_templates" ("id","name","description","icon","definition","version","is_system","system_key","created_by","updated_by","created_at","updated_at")
SELECT s."id", a."name", NULL, a."icon", s."definition", s."version", false, NULL, s."updated_by", s."updated_by", s."created_at", s."updated_at"
FROM "knowledge_structures" s JOIN "knowledge_areas" a ON a."id" = s."area_id";--> statement-breakpoint
INSERT INTO "content_template_versions" ("id","template_id","version","definition","change_note","created_by","created_at")
SELECT v."id", v."structure_id", v."version", v."definition", v."change_note", v."created_by", v."created_at"
FROM "knowledge_structure_versions" v;--> statement-breakpoint
INSERT INTO "knowledge_area_templates" ("area_id","template_id","sort_order")
SELECT s."area_id", s."id", 0 FROM "knowledge_structures" s;