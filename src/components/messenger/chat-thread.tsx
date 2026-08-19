"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCheck, ImagePlus, Loader2, SendHorizontal, X } from "lucide-react";
import { useRealtime, useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { loadOlderMessagesAction, markConversationReadAction, sendMessageAction, typingAction } from "@/server/actions/messages";
import { uploadFile, type UploadedMedia, type UploadError } from "@/lib/upload-client";
import type { ChatMessageDto } from "@/lib/realtime-events";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Props = {
  conversationId: string;
  me: { id: string; name: string; avatarMediaId: string | null };
  other: { id: string; name: string; avatarMediaId: string | null; isBot?: boolean; online: boolean } | null;
  otherLastReadAt: string | null;
  initialMessages: ChatMessageDto[];
  initialHasMore: boolean;
  unreadFrom: string | null;
  maxUploadMb: number;
};

const TYPING_THROTTLE_MS = 2500;
const TYPING_SHOW_MS = 4000;

export function ChatThread({ conversationId, me, other, otherLastReadAt, initialMessages, initialHasMore, unreadFrom, maxUploadMb }: Props) {
  const t = useTranslations("messages");
  const format = useFormatter();
  const { setCounts } = useRealtime();
  const [items, setItems] = useState<ChatMessageDto[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(otherLastReadAt);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pendingUploads, setPendingUploads] = useState<{ localId: string; media: UploadedMedia | null; progress: number }[]>([]);
  const [sending, startSend] = useTransition();
  const [loadingOlder, startOlder] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stickToBottom = useRef(true);

  // Fresh server data (navigation / router.refresh): re-derive local state during render.
  const [prevInitial, setPrevInitial] = useState(initialMessages);
  if (prevInitial !== initialMessages) {
    setPrevInitial(initialMessages);
    setItems(initialMessages);
    setHasMore(initialHasMore);
    setOtherReadAt(otherLastReadAt);
  }

  useLayoutEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items, typingName]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Live events
  useRealtimeEvent("message.created", ({ message }) => {
    if (message.conversationId !== conversationId) return;
    setItems((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    if (message.senderId !== me.id) {
      setTypingName(null);
      if (document.visibilityState === "visible") void markConversationReadAction(conversationId);
    }
  });
  useRealtimeEvent("message.read", (p) => {
    if (p.conversationId === conversationId && p.userId !== me.id) setOtherReadAt(p.at);
  });
  useRealtimeEvent("conversation.typing", (p) => {
    if (p.conversationId !== conversationId || p.userId === me.id) return;
    setTypingName(p.name);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTypingName(null), TYPING_SHOW_MS);
  });

  // Mark read on open and whenever the tab becomes visible again; sync the topbar counter from the response
  // (the SSE connection may not be up yet when the server-side read happened).
  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState !== "visible") return;
      void markConversationReadAction(conversationId).then((r) => setCounts({ unreadMessages: r.unreadMessages }));
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [conversationId, setCounts]);

  const send = useCallback(() => {
    const body = text.trim();
    const attachmentIds = pendingUploads.map((u) => u.media?.id).filter((x): x is string => !!x);
    if ((!body && attachmentIds.length === 0) || pendingUploads.some((u) => !u.media)) return;
    const optimistic: ChatMessageDto = {
      id: `tmp-${crypto.randomUUID()}`,
      conversationId,
      senderId: me.id,
      senderName: me.name,
      senderAvatarMediaId: me.avatarMediaId,
      body,
      attachments: pendingUploads.filter((u) => u.media).map((u) => ({ mediaId: u.media!.id, kind: "image" as const, name: u.media!.originalName, mime: u.media!.mime, size: u.media!.size, width: u.media!.width, height: u.media!.height })),
      createdAt: new Date().toISOString(),
    };
    setItems((prev) => [...prev, optimistic]);
    setText("");
    setPendingUploads([]);
    stickToBottom.current = true;
    startSend(async () => {
      const res = await sendMessageAction({ conversationId, body, attachmentIds });
      if (res.ok) {
        setItems((prev) => (prev.some((m) => m.id === res.message.id) ? prev.filter((m) => m.id !== optimistic.id) : prev.map((m) => (m.id === optimistic.id ? res.message : m))));
      } else {
        setItems((prev) => prev.filter((m) => m.id !== optimistic.id));
        toast.error(t("sendFailed"));
        setText(body);
      }
      textRef.current?.focus();
    });
  }, [text, pendingUploads, conversationId, me, t]);

  const onType = (v: string) => {
    setText(v);
    const now = Date.now();
    if (v.trim() && now - lastTypingSent.current > TYPING_THROTTLE_MS) {
      lastTypingSent.current = now;
      void typingAction(conversationId);
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast.error(t("attachmentUnsupported"));
        continue;
      }
      const localId = crypto.randomUUID();
      setPendingUploads((p) => [...p, { localId, media: null, progress: 0 }]);
      try {
        const media = await uploadFile(file, "message", (f) => setPendingUploads((p) => p.map((u) => (u.localId === localId ? { ...u, progress: f } : u))));
        setPendingUploads((p) => p.map((u) => (u.localId === localId ? { ...u, media, progress: 1 } : u)));
      } catch (e) {
        const err = e as UploadError;
        setPendingUploads((p) => p.filter((u) => u.localId !== localId));
        toast.error(err.code === "too_large" ? t("attachmentTooLarge", { mb: maxUploadMb }) : err.code === "unsupported_type" ? t("attachmentUnsupported") : t("uploadFailed"));
      }
    }
  };

  const loadOlder = () => {
    const first = items[0];
    if (!first) return;
    startOlder(async () => {
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      const res = await loadOlderMessagesAction(conversationId, first.createdAt);
      stickToBottom.current = false;
      setItems((prev) => [...res.items, ...prev]);
      setHasMore(res.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    });
  };

  // Group by day for date separators
  const dayKey = (iso: string) => new Date(iso).toDateString();
  const lastMine = [...items].reverse().find((m) => m.senderId === me.id);
  const seen = !!(lastMine && otherReadAt && new Date(otherReadAt) >= new Date(lastMine.createdAt));

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Button asChild variant="ghost" size="icon" className="md:hidden" aria-label={t("back")}>
          <Link href="/messages">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        {other && (
          <Link href={`/members/${other.id}`} className="flex min-w-0 items-center gap-2.5" title={t("viewProfile")}>
            <span className="relative">
              <UserAvatar user={other} size={32} variant="thumb" />
              {other.online && !other.isBot && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{other.name}</span>
              <span className="block text-xs text-muted-foreground">{other.isBot ? t("botHint") : typingName ? t("typing", { name: typingName }) : other.online ? t("online") : t("offline")}</span>
            </span>
          </Link>
        )}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {hasMore && (
          <div className="mb-4 text-center">
            <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder && <Loader2 className="size-4 animate-spin" />} {t("loadOlder")}
            </Button>
          </div>
        )}
        <ol className="grid gap-1">
          {items.map((m, i) => {
            const prev = items[i - 1];
            const mine = m.senderId === me.id;
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const showNewDivider = unreadFrom && m.createdAt === unreadFrom && !mine;
            const grouped = prev && prev.senderId === m.senderId && !newDay && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
            return (
              <li key={m.id} className="grid gap-1">
                {newDay && (
                  <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {dayKey(m.createdAt) === new Date().toDateString() ? t("today") : format.dateTime(new Date(m.createdAt), { dateStyle: "long" })}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                {showNewDivider && (
                  <div className="my-2 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-blue-600">
                    <span className="h-px flex-1 bg-blue-500/40" />
                    {t("new")}
                    <span className="h-px flex-1 bg-blue-500/40" />
                  </div>
                )}
                <div className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start", grouped ? "mt-0" : "mt-2")}>
                  {!mine && <span className="w-7 shrink-0">{!grouped && <UserAvatar user={{ name: m.senderName, avatarMediaId: m.senderAvatarMediaId }} size={28} variant="thumb" />}</span>}
                  <div className={cn("group max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm", mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted", m.id.startsWith("tmp-") && "opacity-70")}>
                    {m.attachments.length > 0 && (
                      <div className={cn("grid gap-1.5", m.body && "mb-2", m.attachments.length > 1 && "grid-cols-2")}>
                        {m.attachments.map((a) => (
                          <a key={a.mediaId} href={`/api/files/${a.mediaId}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/files/${a.mediaId}${a.kind === "image" ? "?v=thumb" : ""}`} alt={a.name} className="max-h-64 w-full object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                    {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>}
                    <span className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {format.dateTime(new Date(m.createdAt), { timeStyle: "short" })}
                      {mine && lastMine?.id === m.id && (seen ? <CheckCheck className="size-3" aria-label={t("seen")} /> : <Check className="size-3" />)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {typingName && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex gap-0.5">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
            </span>
            {t("typing", { name: typingName })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="shrink-0 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
        }}
      >
        {pendingUploads.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingUploads.map((u) => (
              <span key={u.localId} className="relative size-16 overflow-hidden rounded-md border bg-muted">
                {u.media ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.media.thumbUrl ?? u.media.url} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">{Math.round(u.progress * 100)}%</span>
                )}
                <button type="button" onClick={() => setPendingUploads((p) => p.filter((x) => x.localId !== u.localId))} className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 shadow" aria-label="remove">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => e.currentTarget.files && void addFiles(e.currentTarget.files)} />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label={t("attach")}>
            <ImagePlus className="size-5" />
          </Button>
          <Textarea
            ref={textRef}
            value={text}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            placeholder={t("placeholder")}
            rows={1}
            className="max-h-40 min-h-10 resize-none"
            autoFocus
          />
          <Button type="submit" size="icon" disabled={sending || (!text.trim() && pendingUploads.length === 0) || pendingUploads.some((u) => !u.media)} aria-label={t("send")}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
