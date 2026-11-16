ALTER TABLE "collection_forms" ADD COLUMN "mail_reply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "mail_sent_at" timestamp with time zone;