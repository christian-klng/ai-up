CREATE TYPE "public"."content_type" AS ENUM('markdown', 'image', 'video', 'link');--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text,
	"media_id" uuid,
	"url" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"type" "content_type" NOT NULL,
	"title" text NOT NULL,
	"current_version_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"author_id" text,
	"last_edited_by" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"purpose" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'book' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_media_id_media_files_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_area_id_knowledge_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."knowledge_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_areas" ADD CONSTRAINT "knowledge_areas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_content_no_idx" ON "content_versions" USING btree ("content_id","version_no");--> statement-breakpoint
CREATE INDEX "contents_area_idx" ON "contents" USING btree ("area_id","created_at");--> statement-breakpoint
CREATE INDEX "contents_type_idx" ON "contents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "contents_author_idx" ON "contents" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_areas_slug_idx" ON "knowledge_areas" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "knowledge_areas_sort_idx" ON "knowledge_areas" USING btree ("sort_order");