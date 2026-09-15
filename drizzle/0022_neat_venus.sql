-- One invite link per meeting: keep the newest link of each meeting, point invited members at it,
-- carry over "not revoked" as "enabled", then drop the old columns.
DROP INDEX "meeting_invites_meeting_idx";--> statement-breakpoint
ALTER TABLE "meeting_invites" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "meeting_invites" SET "enabled" = ("revoked_at" IS NULL);--> statement-breakpoint
CREATE TEMP TABLE "invite_keep" AS SELECT DISTINCT ON ("meeting_id") "id", "meeting_id" FROM "meeting_invites" ORDER BY "meeting_id", "revoked_at" IS NOT NULL, "created_at" DESC;--> statement-breakpoint
UPDATE "users" u SET "invited_via_id" = k."id" FROM "meeting_invites" i JOIN "invite_keep" k ON k."meeting_id" = i."meeting_id" WHERE u."invited_via_id" = i."id" AND i."id" <> k."id";--> statement-breakpoint
UPDATE "meeting_invites" i SET "use_count" = s."total" FROM (SELECT "meeting_id", SUM("use_count") AS "total" FROM "meeting_invites" GROUP BY "meeting_id") s WHERE s."meeting_id" = i."meeting_id" AND i."id" IN (SELECT "id" FROM "invite_keep");--> statement-breakpoint
DELETE FROM "meeting_invites" WHERE "id" NOT IN (SELECT "id" FROM "invite_keep");--> statement-breakpoint
DROP TABLE "invite_keep";--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_invites_meeting_idx" ON "meeting_invites" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "meeting_invites" DROP COLUMN "label";--> statement-breakpoint
ALTER TABLE "meeting_invites" DROP COLUMN "revoked_at";
