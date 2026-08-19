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

export type RealtimeEventMap = {
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
  /** Server hint: reload current data (used after reconnect) */
  "sync": Record<string, never>;
};

export type RealtimeEventType = keyof RealtimeEventMap;
export type RealtimeEvent<T extends RealtimeEventType = RealtimeEventType> = { type: T; payload: RealtimeEventMap[T]; at: string };
