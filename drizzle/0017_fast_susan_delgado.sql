CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar_media_id" uuid,
	"provider_id" uuid,
	"model" text,
	"system_prompt" text DEFAULT '' NOT NULL,
	"temperature" text,
	"max_tokens" integer,
	"reasoning_effort" text,
	"max_steps" integer DEFAULT 12 NOT NULL,
	"max_tokens_per_turn" integer DEFAULT 120000 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"bot_user_id" text,
	"owner_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_provider_id_llm_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_bot_user_id_users_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_slug_idx" ON "ai_agents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ai_agents_owner_idx" ON "ai_agents" USING btree ("owner_id");