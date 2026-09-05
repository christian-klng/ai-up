CREATE TYPE "public"."evaluation_status" AS ENUM('pass', 'fail', 'error');--> statement-breakpoint
CREATE TABLE "content_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"template_id" uuid,
	"criterion_key" text NOT NULL,
	"criterion_title" text NOT NULL,
	"criterion_instruction" text NOT NULL,
	"status" "evaluation_status" NOT NULL,
	"reason" text,
	"provider_id" uuid,
	"model" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_templates" ADD COLUMN "evaluation" jsonb DEFAULT '{"providerId":"default","model":"default","criteria":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_evaluations" ADD CONSTRAINT "content_evaluations_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_evaluations" ADD CONSTRAINT "content_evaluations_version_id_content_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_evaluations" ADD CONSTRAINT "content_evaluations_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_evaluations" ADD CONSTRAINT "content_evaluations_provider_id_llm_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_evaluations_version_criterion_idx" ON "content_evaluations" USING btree ("version_id","criterion_key");--> statement-breakpoint
CREATE INDEX "content_evaluations_content_idx" ON "content_evaluations" USING btree ("content_id");