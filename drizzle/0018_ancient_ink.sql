CREATE TYPE "public"."agent_message_role" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."agent_message_status" AS ENUM('streaming', 'complete', 'awaiting_approval', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_thread_mode" AS ENUM('assist', 'curate');--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "agent_message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"tool_name" text,
	"status" "agent_message_status" DEFAULT 'complete' NOT NULL,
	"error" text,
	"usage" jsonb,
	"model" text,
	"step_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_thread_collections" (
	"thread_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	CONSTRAINT "agent_thread_collections_thread_id_area_id_pk" PRIMARY KEY("thread_id","area_id")
);
--> statement-breakpoint
CREATE TABLE "agent_thread_instructions" (
	"thread_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_thread_instructions_thread_id_content_id_pk" PRIMARY KEY("thread_id","content_id")
);
--> statement-breakpoint
CREATE TABLE "agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"mode" "agent_thread_mode" DEFAULT 'assist' NOT NULL,
	"write_approval" text DEFAULT 'always' NOT NULL,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_collections" ADD CONSTRAINT "agent_thread_collections_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_collections" ADD CONSTRAINT "agent_thread_collections_area_id_knowledge_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."knowledge_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_instructions" ADD CONSTRAINT "agent_thread_instructions_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_thread_instructions" ADD CONSTRAINT "agent_thread_instructions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_thread_idx" ON "agent_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_threads_user_idx" ON "agent_threads" USING btree ("user_id","agent_id","last_message_at");