"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, PanelRightClose, PanelRightOpen, SendHorizontal, Square, Wrench } from "lucide-react";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { cancelAgentTurnAction, sendAgentMessageAction } from "@/server/actions/agents";
import { Markdown } from "@/components/content/markdown";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThreadConfigPanel, type AreaOption, type EntryOption } from "./thread-config-panel";
import type { AgentMessageDto } from "@/lib/realtime-events";
import { cn } from "@/lib/utils";

type Props = {
  threadId: string;
  agent: { name: string; avatarMediaId: string | null };
  me: { name: string; avatarMediaId: string | null };
  initialMessages: AgentMessageDto[];
  initialRunning: boolean;
  areas: AreaOption[];
  readAreaIds: string[];
  instructions: EntryOption[];
  toolLabels: Record<string, string>;
};

export function AgentChat({ threadId, agent, me, initialMessages, initialRunning, areas, readAreaIds, instructions, toolLabels }: Props) {
  const t = useTranslations("agents");
  const [messages, setMessages] = useState<AgentMessageDto[]>(initialMessages);
  const [running, setRunning] = useState(initialRunning);
  const [text, setText] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [sending, startSend] = useTransition();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // A thread switch replaces the whole list (derived-state pattern used across the app).
  const [prevThread, setPrevThread] = useState(threadId);
  if (prevThread !== threadId) {
    setPrevThread(threadId);
    setMessages(initialMessages);
    setRunning(initialRunning);
    setText("");
  }

  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const upsert = useCallback((message: AgentMessageDto) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === message.id);
      if (idx === -1) return [...prev, message];
      const next = [...prev];
      next[idx] = message;
      return next;
    });
  }, []);

  useRealtimeEvent("agent.message.started", ({ threadId: id, message }) => {
    if (id === threadId) upsert(message);
  });
  useRealtimeEvent("agent.message.delta", ({ threadId: id, messageId, delta }) => {
    if (id !== threadId) return;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: m.content + delta } : m)));
  });
  useRealtimeEvent("agent.message.saved", ({ threadId: id, message }) => {
    if (id === threadId) upsert(message);
  });
  useRealtimeEvent("agent.turn.finished", ({ threadId: id, status, error }) => {
    if (id !== threadId) return;
    setRunning(false);
    if (status === "error") toast.error(error ?? t("turnFailed"));
    if (status === "limit") toast.warning(t("turnLimit"));
    // The thread title is derived from the first message on the server – pick it up in the list.
    router.refresh();
  });

  const send = () => {
    const body = text.trim();
    if (!body || running) return;
    setText("");
    stick.current = true;
    setRunning(true);
    startSend(async () => {
      const res = await sendAgentMessageAction(threadId, body);
      if (!res.ok) {
        setRunning(false);
        setText(body);
        toast.error(res.reason === "busy" ? t("busy") : t("turnFailed"));
      }
    });
  };

  const stop = () =>
    startSend(async () => {
      await cancelAgentTurnAction(threadId);
      // Unlock right away: if the worker died there is nobody left to send `turn.finished`.
      setRunning(false);
    });

  const visible = messages.filter((m) => m.role !== "tool");

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-end border-b px-3 py-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => setPanelOpen((o) => !o)} aria-label={t("toggleConfig")} aria-expanded={panelOpen}>
            {panelOpen ? <PanelRightClose className="size-5" /> : <PanelRightOpen className="size-5" />}
          </Button>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 overflow-y-auto px-4 py-4"
        >
          {visible.length === 0 && (
            <div className="mx-auto max-w-md py-10 text-center text-sm text-muted-foreground">
              <p>{t("emptyThread")}</p>
              <p className="mt-1">{t("emptyThreadHint")}</p>
            </div>
          )}
          <ol className="mx-auto grid max-w-3xl gap-4">
            {visible.map((m) => {
              const mine = m.role === "user";
              const toolNames = (m.toolCalls ?? []).map((c) => toolLabels[c.name] ?? c.name);
              return (
                <li key={m.id} className={cn("flex gap-3", mine && "flex-row-reverse")}>
                  <UserAvatar user={mine ? me : agent} size={28} variant="thumb" className="mt-0.5" />
                  <div className={cn("min-w-0 max-w-[85%]", mine && "text-right")}>
                    {/* A pure tool round has no prose – then only the tool chips below are shown. */}
                    {(m.content || m.status === "streaming" || m.status === "error") && (
                    <div
                      className={cn(
                        "inline-block rounded-lg px-3 py-2 text-left text-sm",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted",
                        m.status === "error" && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {m.status === "error" ? (
                        <p>{m.error ?? t("turnFailed")}</p>
                      ) : m.content ? (
                        mine ? (
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        ) : (
                          <Markdown className="prose-sm">{m.content}</Markdown>
                        )
                      ) : m.status === "streaming" ? (
                        <span className="inline-flex gap-0.5 py-1" aria-label={t("thinking")}>
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                        </span>
                      ) : null}
                    </div>
                    )}
                    {toolNames.length > 0 && (
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Wrench className="size-3" aria-hidden />
                        {toolNames.join(", ")}
                      </p>
                    )}
                    {m.status === "cancelled" && <p className="mt-1 text-[11px] text-muted-foreground">{t("cancelled")}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <div ref={bottomRef} />
        </div>

        <form
          className="shrink-0 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t("placeholder")}
              rows={1}
              className="max-h-40 min-h-10 resize-none"
              disabled={running}
              autoFocus
            />
            {running ? (
              <Button type="button" size="icon" variant="outline" onClick={stop} aria-label={t("stop")}>
                <Square className="size-4" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label={t("send")}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
              </Button>
            )}
          </div>
        </form>
      </div>

      {panelOpen && (
        <aside className="hidden w-80 shrink-0 border-l lg:block">
          <ThreadConfigPanel threadId={threadId} areas={areas} initialReadAreaIds={readAreaIds} initialInstructions={instructions} />
        </aside>
      )}
    </div>
  );
}
