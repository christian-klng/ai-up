import { relations } from "drizzle-orm";
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
  /** Encrypted JSON blobs for integrations are stored in dedicated tables later; keep generic extras here. */
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

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
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("knowledge_areas_slug_idx").on(t.slug), index("knowledge_areas_sort_idx").on(t.sortOrder)],
);

export const contentTypeEnum = pgEnum("content_type", ["markdown", "image", "video", "link"]);

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

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

// Convenience types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
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

export type KnowledgeArea = typeof knowledgeAreas.$inferSelect;
export type Content = typeof contents.$inferSelect;
export type ContentType = Content["type"];
export type ContentVersion = typeof contentVersions.$inferSelect;
