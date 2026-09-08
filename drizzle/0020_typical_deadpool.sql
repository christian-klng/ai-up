CREATE TABLE "llm_model_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" text NOT NULL,
	"tools" boolean,
	"structured_outputs" boolean,
	"vision" boolean,
	"reasoning_levels" jsonb,
	"context_length" integer,
	"notes" text,
	"source" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_model_capabilities" ADD CONSTRAINT "llm_model_capabilities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_model_capabilities_model_idx" ON "llm_model_capabilities" USING btree ("model_id");