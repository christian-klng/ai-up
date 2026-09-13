CREATE TABLE "meeting_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"token" text NOT NULL,
	"label" text NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_via_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invite_landed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_invites" ADD CONSTRAINT "meeting_invites_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_invites" ADD CONSTRAINT "meeting_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_invites_token_idx" ON "meeting_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "meeting_invites_meeting_idx" ON "meeting_invites" USING btree ("meeting_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_via_id_meeting_invites_id_fk" FOREIGN KEY ("invited_via_id") REFERENCES "public"."meeting_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_invited_via_idx" ON "users" USING btree ("invited_via_id");