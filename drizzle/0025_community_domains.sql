CREATE TABLE "community_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" text NOT NULL,
	"host" text NOT NULL,
	"verify_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_domains" ADD CONSTRAINT "community_domains_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_domains" ADD CONSTRAINT "community_domains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_domains_host_idx" ON "community_domains" USING btree ("host");--> statement-breakpoint
CREATE INDEX "community_domains_community_idx" ON "community_domains" USING btree ("community_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_domains_primary_idx" ON "community_domains" USING btree ("community_id") WHERE "community_domains"."is_primary";