/**
 * Realtime event contract shared by server (publisher) and client (SSE consumer).
 * Keep this file free of server-only imports.
 */
export type ChatMessageDto = {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderName: string;
  senderAvatarMediaId: string | null;
  body: string;
  attachments: { mediaId: string; kind: "image" | "file"; name: string; mime: string; size: number; width?: number | null; height?: number | null }[];
  createdAt: string;
};

export type QuestionDto = {
  id: string;
  questionKey: string;
  title: string;
  description: string | null;
  fields: import("@/server/db/schema").QuestionField[];
  allowDismiss: boolean;
  expiresAt: string | null;
  createdAt: string;
  workflowName: string | null;
};

export type RealtimeEventMap = {
  /** A new question (ask_user action) for this user – shows in the bottom-left dock */
  "question.created": { question: QuestionDto };
  /** Question closed/expired – remove from dock */
  "question.closed": { questionId: string };
  /** New notification for the recipient; unreadCount = total unread notifications after insert */
  "notification.created": { id: string; type: string; title: string; body: string | null; href: string | null; unreadCount: number };
  /** Unread notification counter changed (mark read etc.) */
  "notification.count": { unreadCount: number };
  /** New chat message in a conversation the recipient is a member of */
  "message.created": { message: ChatMessageDto; unreadMessages: number };
  /** Another member read the conversation up to `at` */
  "message.read": { conversationId: string; userId: string; at: string };
  /** Own unread-message counter changed */
  "message.count": { unreadMessages: number };
  /** Someone is typing */
  "conversation.typing": { conversationId: string; userId: string; name: string };
  /** Contact relation changed (request sent/accepted/declined/blocked) – UI refetches */
  "contact.changed": { otherUserId: string; status: string };
  /** Member presence changed */
  "presence.changed": { userId: string; online: boolean };
  /** Admin changed branding/theme – clients reload theme tokens */
  "settings.updated": Record<string, never>;
  /** Workflow run lifecycle (toasts top-right, run pages) */
  "workflow.run.started": { runId: string; workflowId: string; workflowName: string; triggerType: string; startedAt: string };
  "workflow.run.finished": { runId: string; workflowId: string; workflowName: string; status: "succeeded" | "failed" | "cancelled"; durationMs: number; error: string | null; finishedAt: string };
  /** Meeting status/participants changed (webhooks) – refresh lists, sidebar dot, meeting pages */
  "meeting.updated": { meetingId: string; spaceId: string; spaceSlug: string; status: "scheduled" | "live" | "ended"; participantCount: number; recordingStatus: string };
  /** LLM criteria check for an entry finished – the entry page refreshes its verdict popover */
  "content.evaluation.updated": { contentId: string; versionId: string; passed: number; failed: number; errored: number; total: number };
  /** Server hint: reload current data (used after reconnect) */
  "sync": Record<string, never>;
};

export type RealtimeEventType = keyof RealtimeEventMap;
export type RealtimeEvent<T extends RealtimeEventType = RealtimeEventType> = { type: T; payload: RealtimeEventMap[T]; at: string };
