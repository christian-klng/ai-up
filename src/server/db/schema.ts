import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
// Relations
// ---------------------------------------------------------------------------

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

// Convenience types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
