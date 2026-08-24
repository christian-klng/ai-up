ALTER TYPE "public"."content_type" ADD VALUE 'structured';--> statement-breakpoint
CREATE TABLE "knowledge_structure_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"change_note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_structure_versions" ADD CONSTRAINT "knowledge_structure_versions_structure_id_knowledge_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."knowledge_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_structure_versions" ADD CONSTRAINT "knowledge_structure_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_structures" ADD CONSTRAINT "knowledge_structures_area_id_knowledge_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."knowledge_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_structures" ADD CONSTRAINT "knowledge_structures_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_structure_versions_no_idx" ON "knowledge_structure_versions" USING btree ("structure_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_structures_area_idx" ON "knowledge_structures" USING btree ("area_id");