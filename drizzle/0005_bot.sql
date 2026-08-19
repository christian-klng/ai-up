ALTER TABLE "app_settings" ADD COLUMN "bot_name" text DEFAULT 'Assistent' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;