CREATE TABLE "collection_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"token" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"template_id" uuid,
	"field_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"texts" jsonb NOT NULL,
	"contact" text DEFAULT 'off' NOT NULL,
	"success" jsonb NOT NULL,
	"daily_limit" integer DEFAULT 200 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"enabled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"form_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"access_key_hash" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"mail_consent" boolean DEFAULT false NOT NULL,
	"page_url" text,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "external" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_forms" ADD CONSTRAINT "collection_forms_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_forms" ADD CONSTRAINT "collection_forms_area_id_knowledge_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."knowledge_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_forms" ADD CONSTRAINT "collection_forms_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_forms" ADD CONSTRAINT "collection_forms_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_collection_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."collection_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_forms_token_idx" ON "collection_forms" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_forms_area_idx" ON "collection_forms" USING btree ("area_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submissions_content_idx" ON "form_submissions" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("form_id","created_at");