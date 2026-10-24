CREATE TABLE "content_media" (
	"content_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "content_media_content_id_media_id_pk" PRIMARY KEY("content_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"show_in_nav" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "landing_page_versions_page_version_idx";--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "knowledge_areas" ADD COLUMN "public_on_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "landing_page_versions" ADD COLUMN "site_page_id" uuid;--> statement-breakpoint
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_media_id_media_files_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_media_media_idx" ON "content_media" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_slug_idx" ON "site_pages" USING btree ("community_id","slug");--> statement-breakpoint
ALTER TABLE "landing_page_versions" ADD CONSTRAINT "landing_page_versions_site_page_id_site_pages_id_fk" FOREIGN KEY ("site_page_id") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contents_area_slug_idx" ON "contents" USING btree ("area_id","slug");--> statement-breakpoint
CREATE INDEX "contents_published_idx" ON "contents" USING btree ("area_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "landing_page_versions_site_page_version_idx" ON "landing_page_versions" USING btree ("site_page_id","version") WHERE "landing_page_versions"."site_page_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "landing_page_versions_page_version_idx" ON "landing_page_versions" USING btree ("community_id","page","version") WHERE "landing_page_versions"."site_page_id" is null;