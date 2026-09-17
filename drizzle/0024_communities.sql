-- Communities (multi-tenancy), phase A. See docs/communities.md.
--
-- The installation becomes the "root" community: app_settings is *renamed* (not recreated) so its
-- row, and therefore the branding, purpose and quota of the running installation, carries over.
-- Everything that existed before belongs to that community.

ALTER TABLE "app_settings" RENAME TO "communities";
--> statement-breakpoint
-- new enums
CREATE TYPE "public"."member_role" AS ENUM('member', 'admin');
--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('pending', 'active', 'suspended');
--> statement-breakpoint
-- new tables
CREATE TABLE "community_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"token" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_members" (
	"community_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"status" "member_status" DEFAULT 'pending' NOT NULL,
	"registration_message" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"invited_via_id" uuid,
	"invite_landed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_members_community_id_user_id_pk" PRIMARY KEY("community_id","user_id")
);
--> statement-breakpoint
-- drop indexes that are about to become community-scoped
DROP INDEX "users_invited_via_idx";
--> statement-breakpoint
DROP INDEX "ai_agents_slug_idx";
--> statement-breakpoint
DROP INDEX "contact_requests_pair_idx";
--> statement-breakpoint
DROP INDEX "knowledge_areas_slug_idx";
--> statement-breakpoint
DROP INDEX "knowledge_areas_sort_idx";
--> statement-breakpoint
DROP INDEX "landing_page_versions_page_version_idx";
--> statement-breakpoint
DROP INDEX "meeting_spaces_slug_idx";
--> statement-breakpoint
DROP INDEX "meeting_spaces_sort_idx";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_invited_via_id_meeting_invites_id_fk";
--> statement-breakpoint
-- plain new columns
ALTER TABLE "audit_log" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "content_templates" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "parent_id" text;
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "allow_member_subcommunities" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "allow_registration" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "created_by" text;
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
-- community_id columns – nullable until backfilled
ALTER TABLE "ai_agents" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_areas" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "landing_page_versions" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "llm_providers" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "meeting_spaces" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "slug" text;
--> statement-breakpoint
-- backfill: everything that exists today belongs to the root community
-- The root community keeps the id it had as the settings singleton.
UPDATE "communities" SET "slug" = 'default' WHERE "slug" IS NULL;
--> statement-breakpoint
UPDATE "ai_agents" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "api_keys" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "contact_requests" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "conversations" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "knowledge_areas" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "landing_page_versions" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "llm_providers" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "meeting_spaces" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "questions" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "workflow_runs" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "workflows" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "notifications" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "audit_log" SET "community_id" = 'default' WHERE "community_id" IS NULL;
--> statement-breakpoint
-- Custom templates belong to the root; the seeded system templates stay shared (community_id null).
UPDATE "content_templates" SET "community_id" = 'default' WHERE "is_system" = false;
--> statement-breakpoint
-- Uploads belong to the root; generated account avatars stay platform-wide so they follow the
-- person into every community they are a member of.
UPDATE "media_files" SET "community_id" = 'default' WHERE "purpose" <> 'avatar';
--> statement-breakpoint
-- now the columns can be tightened
ALTER TABLE "ai_agents" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "contact_requests" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_areas" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "landing_page_versions" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "llm_providers" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "meeting_spaces" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "community_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "communities" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
-- memberships: one row per account, carrying role, approval and invite origin
INSERT INTO "community_members" ("community_id", "user_id", "role", "status", "registration_message", "approved_at", "approved_by", "invited_via_id", "invite_landed_at", "last_seen_at", "joined_at")
SELECT 'default', u."id", u."role"::text::"member_role", u."status"::text::"member_status",
       u."registration_message", u."approved_at", u."approved_by", u."invited_via_id", u."invite_landed_at", u."last_seen_at", u."created_at"
FROM "users" u;
--> statement-breakpoint
-- users.status now only says whether the account may sign in at all; an account that was approved
-- anywhere is active. users.role stays as a deprecated column and is no longer read.
UPDATE "users" SET "status" = 'active'
WHERE "status" = 'pending' AND "id" IN (SELECT "user_id" FROM "community_members" WHERE "status" = 'active');
--> statement-breakpoint
-- foreign keys
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_invited_via_id_meeting_invites_id_fk" FOREIGN KEY ("invited_via_id") REFERENCES "public"."meeting_invites"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_areas" ADD CONSTRAINT "knowledge_areas_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "landing_page_versions" ADD CONSTRAINT "landing_page_versions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_spaces" ADD CONSTRAINT "meeting_spaces_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_parent_id_communities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- indexes
CREATE UNIQUE INDEX "community_invites_token_idx" ON "community_invites" USING btree ("token");
--> statement-breakpoint
CREATE UNIQUE INDEX "community_invites_community_idx" ON "community_invites" USING btree ("community_id");
--> statement-breakpoint
CREATE INDEX "community_members_user_idx" ON "community_members" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "community_members_status_idx" ON "community_members" USING btree ("community_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_system_idx" ON "ai_agents" USING btree ("community_id") WHERE "ai_agents"."is_system";
--> statement-breakpoint
CREATE INDEX "media_files_community_idx" ON "media_files" USING btree ("community_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "communities_slug_idx" ON "communities" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "communities_parent_idx" ON "communities" USING btree ("parent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_slug_idx" ON "ai_agents" USING btree ("community_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_requests_pair_idx" ON "contact_requests" USING btree ("community_id","requester_id","addressee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_areas_slug_idx" ON "knowledge_areas" USING btree ("community_id","slug");
--> statement-breakpoint
CREATE INDEX "knowledge_areas_sort_idx" ON "knowledge_areas" USING btree ("community_id","sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "landing_page_versions_page_version_idx" ON "landing_page_versions" USING btree ("community_id","page","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_spaces_slug_idx" ON "meeting_spaces" USING btree ("community_id","slug");
--> statement-breakpoint
CREATE INDEX "meeting_spaces_sort_idx" ON "meeting_spaces" USING btree ("community_id","sort_order");
--> statement-breakpoint
-- the account columns that moved into community_members
ALTER TABLE "users" DROP COLUMN "registration_message";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "approved_at";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "approved_by";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "invited_via_id";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "invite_landed_at";
