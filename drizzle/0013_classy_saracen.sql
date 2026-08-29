DROP INDEX "landing_page_versions_version_idx";--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "imprint_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "privacy_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "landing_page_versions" ADD COLUMN "page" text DEFAULT 'landing' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "landing_page_versions_page_version_idx" ON "landing_page_versions" USING btree ("page","version");