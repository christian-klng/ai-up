import { relations } from "drizzle-orm";
import type { CollectionLayout } from "@/lib/collection-layouts";
import type { LandingDefinition } from "@/lib/landing-schema";
import type { StructureDefinition, StructureEntryMeta } from "@/lib/structures/types";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Database schema (Phase 1: identity, settings, media, API keys, notifications, audit log).
 * Column names are snake_case via `casing: "snake_case"` on the drizzle client.
 */

export const userRoleEnum = pgEnum("user_role", ["member", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["pending", "active", "suspended"]);
export const localeEnum = pgEnum("locale", ["de", "en"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Identity (Better Auth core tables + our extensions)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // --- AI-Up extensions ---
    role: userRoleEnum("role").notNull().default("member"),
    status: userStatusEnum("status").notNull().default("pending"),
    locale: localeEnum("locale").notNull().default("de"),
    bio: text("bio"),
    avatarMediaId: uuid("avatar_media_id"),
    registrationMessage: text("registration_message"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** System bot (workflow messages); hidden from member lists, cannot log in */
    isBot: boolean("is_bot").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), index("users_status_idx").on(t.status)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// App settings (singleton row, id = "default")
// ---------------------------------------------------------------------------

export type ThemeSettings = {
  /** Primary brand color as hex, e.g. "#2563eb" */
  primaryColor: string;
  /** Border radius in rem */
  radius: number;
  /** Default color mode */
  mode: "light" | "dark" | "system";
};

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull().default("AI-Up"),
  tagline: text("tagline"),
  purpose: text("purpose"),
  logoMediaId: uuid("logo_media_id"),
  faviconMediaId: uuid("favicon_media_id"),
  theme: jsonb("theme").$type<ThemeSettings>().notNull().default({ primaryColor: "#2563eb", radius: 0.5, mode: "system" }),
  defaultLocale: localeEnum("default_locale").notNull().default("de"),
  /** Display name of the system bot that sends workflow messages */
  botName: text("bot_name").notNull().default("Assistent"),
  /** Serve the public landing page at "/"; when false, "/" redirects to /login resp. /home. */
  landingEnabled: boolean("landing_enabled").notNull().default(false),
  /** Serve the public imprint page at /imprint (404 when disabled). */
  imprintEnabled: boolean("imprint_enabled").notNull().default(false),
  /** Serve the public privacy page at /privacy (404 when disabled). */
  privacyEnabled: boolean("privacy_enabled").notNull().default(false),
  /** Encrypted JSON blobs for integrations are stored in dedicated tables later; keep generic extras here. */
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Landing page (singleton like app_settings; append-only versions, current = max version)
// ---------------------------------------------------------------------------

export const landingPageVersions = pgTable(
  "landing_page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which public page this version belongs to: landing | imprint | privacy */
    page: text("page").notNull().default("landing"),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<LandingDefinition>().notNull(),
    /** ui | mcp */
    source: text("source").notNull().default("ui"),
    changeNote: text("change_note"),
    changedBy: text("changed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("landing_page_versions_page_version_idx").on(t.page, t.version)],
);

// ---------------------------------------------------------------------------
// Media files (uploads live on the volume; never overwritten)
// ---------------------------------------------------------------------------

export const mediaKindEnum = pgEnum("media_kind", ["image", "video", "audio", "file"]);

export const mediaFiles = pgTable(
  "media_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: mediaKindEnum("kind").notNull(),
    storagePath: text("storage_path").notNull(),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    /** Derived variants, e.g. { thumb: "path", sm: "path" } */
    variants: jsonb("variants").$type<Record<string, string>>().notNull().default({}),
    /** Which feature owns this file (avatar, logo, favicon, content, message, recording) */
    purpose: text("purpose").notNull(),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_files_uploaded_by_idx").on(t.uploadedBy), index("media_files_sha_idx").on(t.sha256)],
);

// ---------------------------------------------------------------------------
// API keys (for MCP / external tooling)
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** e.g. member.pending, member.approved, contact.request, workflow.result */
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Deep link + optional action payload */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_unread_idx").on(t.userId, t.readAt), index("notifications_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// Messenger: contact requests, conversations, messages
// ---------------------------------------------------------------------------

export const contactStatusEnum = pgEnum("contact_status", ["pending", "accepted", "declined", "blocked"]);

/**
 * A contact relation between two members. Messaging requires an accepted request.
 * One row per unordered pair: (requester, addressee) is unique and we look up both directions.
 */
export const contactRequests = pgTable(
  "contact_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: text("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: contactStatusEnum("status").notNull().default("pending"),
    message: text("message"),
    /** who blocked (only when status = blocked) */
    blockedBy: text("blocked_by"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("contact_requests_pair_idx").on(t.requesterId, t.addresseeId),
    index("contact_requests_addressee_idx").on(t.addresseeId, t.status),
    index("contact_requests_requester_idx").on(t.requesterId, t.status),
  ],
);

export const conversationKindEnum = pgEnum("conversation_kind", ["direct", "group"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: conversationKindEnum("kind").notNull().default("direct"),
    title: text("title"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    lastMessageSenderId: text("last_message_sender_id"),
    ...timestamps,
  },
  (t) => [index("conversations_last_message_idx").on(t.lastMessageAt)],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    muted: boolean("muted").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("conversation_members_user_idx").on(t.userId)],
);

export type MessageAttachment = { mediaId: string; kind: "image" | "file"; name: string; mime: string; size: number; width?: number | null; height?: number | null };

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: text("sender_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull().default(""),
    attachments: jsonb("attachments").$type<MessageAttachment[]>().notNull().default([]),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Workflows (engine room): definitions, versions, runs, steps, LLM providers
// ---------------------------------------------------------------------------

/** Trigger part of a workflow definition. `type` refers to the trigger registry (English ids). */
export type WorkflowTrigger = { type: string; config: Record<string, unknown> };
/** One step of a workflow: an action with config; templates use LiquidJS. */
export type WorkflowStep = {
  id: string;
  name?: string;
  action: string;
  config: Record<string, unknown>;
  /** Liquid expression – step runs only if it renders to a truthy value ("true", non-empty, non-"false"). */
  condition?: string;
  onError?: "stop" | "continue";
};
export type WorkflowDefinition = { name: string; description?: string | null; trigger: WorkflowTrigger; steps: WorkflowStep[] };

export const workflowStatusEnum = pgEnum("workflow_status", ["draft", "active", "paused"]);

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: workflowStatusEnum("status").notNull().default("draft"),
    trigger: jsonb("trigger").$type<WorkflowTrigger>().notNull(),
    steps: jsonb("steps").$type<WorkflowStep[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    /** Toast visibility for members: all | admins */
    toastAudience: text("toast_audience").notNull().default("all"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("workflows_status_idx").on(t.status)],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
    /** ui | mcp | system */
    source: text("source").notNull().default("ui"),
    changeNote: text("change_note"),
    changedBy: text("changed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workflow_versions_wf_version_idx").on(t.workflowId, t.version)],
);

export const runStatusEnum = pgEnum("run_status", ["queued", "running", "succeeded", "failed", "cancelled"]);

export type StepUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number; model?: string };

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflowVersion: integer("workflow_version").notNull(),
    workflowName: text("workflow_name").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    triggerType: text("trigger_type").notNull(),
    triggerEvent: jsonb("trigger_event").$type<Record<string, unknown>>().notNull().default({}),
    /** Final template context snapshot (steps outputs) – handy for debugging and MCP */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    /** user who triggered (manual runs / content authors) – used for notify_user audience "triggerUser" */
    triggeredBy: text("triggered_by").references(() => users.id, { onDelete: "set null" }),
    /** Runs spawned by other runs (create_content → content.created) carry the parent to prevent loops */
    parentRunId: uuid("parent_run_id"),
    depth: integer("depth").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_runs_wf_created_idx").on(t.workflowId, t.createdAt), index("workflow_runs_status_idx").on(t.status), index("workflow_runs_created_idx").on(t.createdAt)],
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    stepId: text("step_id").notNull(),
    stepName: text("step_name"),
    actionType: text("action_type").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    /** Rendered config (templates resolved) */
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    skipped: boolean("skipped").notNull().default(false),
    usage: jsonb("usage").$type<StepUsage>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("workflow_run_steps_run_idx").on(t.runId, t.index)],
);

export const llmProviderKindEnum = pgEnum("llm_provider_kind", ["openrouter", "cortecs", "openai", "generic"]);

export type LlmModelInfo = {
  id: string;
  name?: string;
  contextLength?: number | null;
  /** e.g. ["temperature","top_p","max_tokens","response_format","structured_outputs","reasoning","tools"] */
  supportedParameters?: string[];
  pricing?: { prompt?: string; completion?: string } | null;
};

export const llmProviders = pgTable(
  "llm_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: llmProviderKindEnum("kind").notNull().default("generic"),
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM encrypted (see src/server/crypto.ts) */
    apiKeyEncrypted: text("api_key_encrypted"),
    extraHeaders: jsonb("extra_headers").$type<Record<string, string>>().notNull().default({}),
    availableModels: jsonb("available_models").$type<LlmModelInfo[]>().notNull().default([]),
    enabledModels: jsonb("enabled_models").$type<string[]>().notNull().default([]),
    defaultModel: text("default_model"),
    isDefault: boolean("is_default").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
);

// ---------------------------------------------------------------------------
// Questions (workflow action "ask_user": mini forms shown bottom-left)
// ---------------------------------------------------------------------------

export type QuestionField =
  | { key: string; type: "single_choice"; label: string; options: string[]; required?: boolean }
  | { key: string; type: "multi_choice"; label: string; options: string[]; required?: boolean }
  | { key: string; type: "text"; label: string; placeholder?: string; required?: boolean }
  | { key: string; type: "rating"; label: string; max?: number; required?: boolean }
  | { key: string; type: "yes_no"; label: string; required?: boolean }
  | { key: string; type: "cta"; label: string; buttonLabel: string; href?: string };

export type QuestionAudience = { type: "triggerUser" | "admins" | "all" | "users"; userIds: string[] };

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable key from the ask_user step config – the `question.answered` trigger filters on it */
    questionKey: text("question_key").notNull(),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    stepId: text("step_id"),
    title: text("title").notNull(),
    description: text("description"),
    fields: jsonb("fields").$type<QuestionField[]>().notNull().default([]),
    audience: jsonb("audience").$type<QuestionAudience>().notNull().default({ type: "all", userIds: [] }),
    /** resolved recipient ids at creation time (empty = everyone active) */
    recipientIds: jsonb("recipient_ids").$type<string[]>().notNull().default([]),
    allowDismiss: boolean("allow_dismiss").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("questions_key_idx").on(t.questionKey), index("questions_open_idx").on(t.closedAt, t.createdAt)],
);

export const questionResponses = pgTable(
  "question_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("question_responses_q_user_idx").on(t.questionId, t.userId)],
);

export const questionDismissals = pgTable(
  "question_dismissals",
  {
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })],
);

// ---------------------------------------------------------------------------
// Meetings: spaces, meetings (protocol / audio / video), protocol versions, participants
// ---------------------------------------------------------------------------

export const meetingSpaces = pgTable(
  "meeting_spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    purpose: text("purpose").notNull(),
    description: text("description"),
    icon: text("icon").notNull().default("calendar"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** default for new audio/video meetings in this space */
    recordingDefault: boolean("recording_default").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("meeting_spaces_slug_idx").on(t.slug), index("meeting_spaces_sort_idx").on(t.sortOrder)],
);

export const meetingKindEnum = pgEnum("meeting_kind", ["protocol", "audio", "video"]);
export const meetingStatusEnum = pgEnum("meeting_status", ["scheduled", "live", "ended"]);
export const recordingStatusEnum = pgEnum("recording_status", ["none", "recording", "processing", "available", "failed"]);

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => meetingSpaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    kind: meetingKindEnum("kind").notNull().default("protocol"),
    status: meetingStatusEnum("status").notNull().default("scheduled"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    hostId: text("host_id").references(() => users.id, { onDelete: "set null" }),
    /** current protocol (markdown); history in meeting_protocol_versions */
    protocolMarkdown: text("protocol_markdown"),
    protocolVersion: integer("protocol_version").notNull().default(0),
    /** LiveKit room name (= meeting id by convention) */
    roomName: text("room_name"),
    recordingEnabled: boolean("recording_enabled").notNull().default(false),
    recordingStatus: recordingStatusEnum("recording_status").notNull().default("none"),
    recordingEgressId: text("recording_egress_id"),
    recordingMediaId: uuid("recording_media_id").references(() => mediaFiles.id, { onDelete: "set null" }),
    recordingError: text("recording_error"),
    /** transcript of the recording (markdown), written by the set_meeting_transcript workflow action */
    transcriptMarkdown: text("transcript_markdown"),
    /** live participant count (maintained by webhooks) */
    participantCount: integer("participant_count").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("meetings_space_idx").on(t.spaceId, t.startsAt), index("meetings_status_idx").on(t.status), index("meetings_room_idx").on(t.roomName)],
);

export const meetingProtocolVersions = pgTable(
  "meeting_protocol_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    body: text("body").notNull(),
    changeNote: text("change_note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("meeting_protocol_versions_idx").on(t.meetingId, t.versionNo)],
);

export const meetingParticipants = pgTable(
  "meeting_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** LiveKit participant identity / sid for matching webhook events */
    identity: text("identity").notNull(),
    displayName: text("display_name"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [index("meeting_participants_meeting_idx").on(t.meetingId, t.joinedAt), index("meeting_participants_user_idx").on(t.userId)],
);

/** Append-only log of finished recordings; meetings.recordingMediaId points at the newest one. */
export const meetingRecordings = pgTable(
  "meeting_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaFiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meeting_recordings_meeting_idx").on(t.meetingId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Integrations (LiveKit, later Nextcloud …): public config as JSON + encrypted secrets
// ---------------------------------------------------------------------------

export const integrations = pgTable("integrations", {
  /** e.g. "livekit" */
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  /** AES-256-GCM encrypted JSON of secret fields */
  secretsEncrypted: text("secrets_encrypted"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestResult: text("last_test_result"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt), index("audit_log_actor_idx").on(t.actorId)],
);

// ---------------------------------------------------------------------------
// Knowledge areas & contents (versioned)
// ---------------------------------------------------------------------------

export const knowledgeAreas = pgTable(
  "knowledge_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Required: what this area is for. Shown to members and embedded into LLM prompts. */
    purpose: text("purpose").notNull(),
    description: text("description"),
    /** lucide icon key, see src/components/knowledge/area-icon.tsx */
    icon: text("icon").notNull().default("book"),
    /** member view layout, see src/lib/collection-layouts.ts */
    layout: text("layout").$type<CollectionLayout>().notNull().default("grid"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("knowledge_areas_slug_idx").on(t.slug), index("knowledge_areas_sort_idx").on(t.sortOrder)],
);

export const contentTypeEnum = pgEnum("content_type", ["markdown", "image", "video", "link", "structured"]);

/**
 * Content templates ("Vorlagen"): standalone, admin-managed structure
 * definitions. Admins assign them per collection (knowledge_area_templates);
 * a collection without assignments offers the seeded system templates
 * (is_system, src/lib/structures/defaults.ts — not editable or deletable).
 * Definition JSON lives in src/lib/structures/types.ts; validated via
 * src/lib/structures/validate.ts. Entries keep a full definition snapshot,
 * so templates can change or disappear without breaking existing entries.
 */
export const contentTemplates = pgTable(
  "content_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    /** lucide icon key, same set as collection icons */
    icon: text("icon").notNull().default("file-text"),
    definition: jsonb("definition").$type<StructureDefinition>().notNull(),
    version: integer("version").notNull().default(1),
    isSystem: boolean("is_system").notNull().default(false),
    /** stable key for system templates: text | image | link | video */
    systemKey: text("system_key"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("content_templates_system_key_idx").on(t.systemKey)],
);

export const contentTemplateVersions = pgTable(
  "content_template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => contentTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<StructureDefinition>().notNull(),
    changeNote: text("change_note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_template_versions_no_idx").on(t.templateId, t.version)],
);

/** Which templates an admin offers in a collection. No rows = system templates. */
export const knowledgeAreaTemplates = pgTable(
  "knowledge_area_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => knowledgeAreas.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => contentTemplates.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("knowledge_area_templates_pair_idx").on(t.areaId, t.templateId), index("knowledge_area_templates_area_idx").on(t.areaId)],
);

/** Type-specific metadata stored on each version. */
export type LinkPreview = {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  fetchedAt?: string;
};
export type ContentVersionMeta = {
  /** link/image/video by URL: preview + provider info */
  preview?: LinkPreview;
  /** video: youtube | vimeo | file | url */
  provider?: "youtube" | "vimeo" | "file" | "url";
  /** embed id for youtube/vimeo */
  embedId?: string;
  /** image/video dimensions if known */
  width?: number;
  height?: number;
  /** optional caption/alt text for images */
  alt?: string;
  /** structured entries: definition snapshot + answers (self-contained) */
  structure?: StructureEntryMeta;
};

export const contents = pgTable(
  "contents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => knowledgeAreas.id, { onDelete: "cascade" }),
    type: contentTypeEnum("type").notNull(),
    title: text("title").notNull(),
    /** Points at the latest version (no FK to avoid a cycle; maintained by the domain layer). */
    currentVersionId: uuid("current_version_id"),
    versionCount: integer("version_count").notNull().default(0),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    lastEditedBy: text("last_edited_by").references(() => users.id, { onDelete: "set null" }),
    pinned: boolean("pinned").notNull().default(false),
    /** Denormalized text for search (title + body/url/preview) */
    searchText: text("search_text").notNull().default(""),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("contents_area_idx").on(t.areaId, t.createdAt),
    index("contents_type_idx").on(t.type),
    index("contents_author_idx").on(t.authorId),
  ],
);

export const contentVersions = pgTable(
  "content_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    title: text("title").notNull(),
    bodyMarkdown: text("body_markdown"),
    mediaId: uuid("media_id").references(() => mediaFiles.id, { onDelete: "set null" }),
    url: text("url"),
    meta: jsonb("meta").$type<ContentVersionMeta>().notNull().default({}),
    changeNote: text("change_note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_versions_content_no_idx").on(t.contentId, t.versionNo)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const knowledgeAreasRelations = relations(knowledgeAreas, ({ many }) => ({
  contents: many(contents),
  templates: many(knowledgeAreaTemplates),
}));

export const contentTemplatesRelations = relations(contentTemplates, ({ many }) => ({
  versions: many(contentTemplateVersions),
  assignments: many(knowledgeAreaTemplates),
}));

export const contentTemplateVersionsRelations = relations(contentTemplateVersions, ({ one }) => ({
  template: one(contentTemplates, { fields: [contentTemplateVersions.templateId], references: [contentTemplates.id] }),
}));

export const knowledgeAreaTemplatesRelations = relations(knowledgeAreaTemplates, ({ one }) => ({
  area: one(knowledgeAreas, { fields: [knowledgeAreaTemplates.areaId], references: [knowledgeAreas.id] }),
  template: one(contentTemplates, { fields: [knowledgeAreaTemplates.templateId], references: [contentTemplates.id] }),
}));

export const contentsRelations = relations(contents, ({ one, many }) => ({
  area: one(knowledgeAreas, { fields: [contents.areaId], references: [knowledgeAreas.id] }),
  author: one(users, { fields: [contents.authorId], references: [users.id] }),
  versions: many(contentVersions),
}));

export const contentVersionsRelations = relations(contentVersions, ({ one }) => ({
  content: one(contents, { fields: [contentVersions.contentId], references: [contents.id] }),
  media: one(mediaFiles, { fields: [contentVersions.mediaId], references: [mediaFiles.id] }),
  createdByUser: one(users, { fields: [contentVersions.createdBy], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  notifications: many(notifications),
  avatar: one(mediaFiles, { fields: [users.avatarMediaId], references: [mediaFiles.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const contactRequestsRelations = relations(contactRequests, ({ one }) => ({
  requester: one(users, { fields: [contactRequests.requesterId], references: [users.id] }),
  addressee: one(users, { fields: [contactRequests.addresseeId], references: [users.id] }),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  members: many(conversationMembers),
  messages: many(messages),
}));

export const conversationMembersRelations = relations(conversationMembers, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationMembers.conversationId], references: [conversations.id] }),
  user: one(users, { fields: [conversationMembers.userId], references: [users.id] }),
}));

export const workflowsRelations = relations(workflows, ({ many }) => ({
  versions: many(workflowVersions),
  runs: many(workflowRuns),
}));
export const workflowRunsRelations = relations(workflowRuns, ({ one, many }) => ({
  workflow: one(workflows, { fields: [workflowRuns.workflowId], references: [workflows.id] }),
  steps: many(workflowRunSteps),
}));
export const workflowRunStepsRelations = relations(workflowRunSteps, ({ one }) => ({
  run: one(workflowRuns, { fields: [workflowRunSteps.runId], references: [workflowRuns.id] }),
}));

export const meetingSpacesRelations = relations(meetingSpaces, ({ many }) => ({ meetings: many(meetings) }));
export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  space: one(meetingSpaces, { fields: [meetings.spaceId], references: [meetingSpaces.id] }),
  host: one(users, { fields: [meetings.hostId], references: [users.id] }),
  recording: one(mediaFiles, { fields: [meetings.recordingMediaId], references: [mediaFiles.id] }),
  protocolVersions: many(meetingProtocolVersions),
  participants: many(meetingParticipants),
  recordings: many(meetingRecordings),
}));
export const meetingRecordingsRelations = relations(meetingRecordings, ({ one }) => ({
  meeting: one(meetings, { fields: [meetingRecordings.meetingId], references: [meetings.id] }),
  media: one(mediaFiles, { fields: [meetingRecordings.mediaId], references: [mediaFiles.id] }),
}));
export const meetingProtocolVersionsRelations = relations(meetingProtocolVersions, ({ one }) => ({
  meeting: one(meetings, { fields: [meetingProtocolVersions.meetingId], references: [meetings.id] }),
}));
export const meetingParticipantsRelations = relations(meetingParticipants, ({ one }) => ({
  meeting: one(meetings, { fields: [meetingParticipants.meetingId], references: [meetings.id] }),
  user: one(users, { fields: [meetingParticipants.userId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

// Convenience types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type LandingPageVersion = typeof landingPageVersions.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ContactRequest = typeof contactRequests.$inferSelect;
export type ContactStatus = ContactRequest["status"];
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type WorkflowRunStep = typeof workflowRunSteps.$inferSelect;
export type RunStatus = WorkflowRun["status"];
export type LlmProvider = typeof llmProviders.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionResponse = typeof questionResponses.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type MeetingSpace = typeof meetingSpaces.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingKind = Meeting["kind"];
export type MeetingStatus = Meeting["status"];
export type MeetingProtocolVersion = typeof meetingProtocolVersions.$inferSelect;
export type MeetingParticipant = typeof meetingParticipants.$inferSelect;
export type Integration = typeof integrations.$inferSelect;

export type KnowledgeArea = typeof knowledgeAreas.$inferSelect;
export type ContentTemplate = typeof contentTemplates.$inferSelect;
export type ContentTemplateVersion = typeof contentTemplateVersions.$inferSelect;
export type KnowledgeAreaTemplate = typeof knowledgeAreaTemplates.$inferSelect;
export type Content = typeof contents.$inferSelect;
export type ContentType = Content["type"];
export type ContentVersion = typeof contentVersions.$inferSelect;
