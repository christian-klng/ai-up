"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RealtimeEvent, RealtimeEventMap, RealtimeEventType } from "@/lib/realtime-events";

type Handler<T extends RealtimeEventType> = (payload: RealtimeEventMap[T], event: RealtimeEvent<T>) => void;

type Counts = { unreadMessages: number; unreadNotifications: number };

type RealtimeContextValue = {
  connected: boolean;
  counts: Counts;
  setCounts: (patch: Partial<Counts>) => void;
  subscribe: <T extends RealtimeEventType>(type: T, handler: Handler<T>) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * Holds one EventSource per tab, dispatches events to subscribers, and keeps the topbar counters live.
 * Reconnects automatically (browser EventSource); after a reconnect the server sends `sync` and we refresh.
 */
export function RealtimeProvider({ userId, initialCounts, children }: { userId: string; initialCounts: Counts; children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [counts, setCountsState] = useState<Counts>(initialCounts);
  const handlers = useRef(new Map<RealtimeEventType, Set<Handler<RealtimeEventType>>>());
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const hadConnection = useRef(false);

  // Keep counters in sync with fresh server renders (derived-state pattern: compare previous prop during render)
  const [prevInitial, setPrevInitial] = useState(initialCounts);
  if (prevInitial !== initialCounts) {
    setPrevInitial(initialCounts);
    setCountsState(initialCounts);
  }

  const setCounts = useCallback((patch: Partial<Counts>) => setCountsState((c) => ({ ...c, ...patch })), []);

  const subscribe = useCallback(<T extends RealtimeEventType>(type: T, handler: Handler<T>) => {
    const set = handlers.current.get(type) ?? new Set();
    set.add(handler as Handler<RealtimeEventType>);
    handlers.current.set(type, set);
    return () => {
      set.delete(handler as Handler<RealtimeEventType>);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }
      // Built-in reactions
      switch (event.type) {
        case "sync": {
          if (hadConnection.current) router.refresh();
          hadConnection.current = true;
          break;
        }
        case "notification.created": {
          const p = event.payload as RealtimeEventMap["notification.created"];
          setCountsState((c) => ({ ...c, unreadNotifications: p.unreadCount }));
          toast(p.title, { description: p.body ?? undefined, action: p.href ? { label: "→", onClick: () => router.push(p.href!) } : undefined });
          if (pathnameRef.current === "/notifications") router.refresh();
          break;
        }
        case "notification.count": {
          const p = event.payload as RealtimeEventMap["notification.count"];
          setCountsState((c) => ({ ...c, unreadNotifications: p.unreadCount }));
          break;
        }
        case "message.created": {
          const p = event.payload as RealtimeEventMap["message.created"];
          setCountsState((c) => ({ ...c, unreadMessages: p.unreadMessages }));
          break;
        }
        case "message.count": {
          const p = event.payload as RealtimeEventMap["message.count"];
          setCountsState((c) => ({ ...c, unreadMessages: p.unreadMessages }));
          break;
        }
        case "contact.changed": {
          if (pathnameRef.current.startsWith("/members") || pathnameRef.current.startsWith("/messages") || pathnameRef.current === "/notifications") router.refresh();
          break;
        }
        case "settings.updated": {
          router.refresh();
          break;
        }
        default:
          break;
      }
      const set = handlers.current.get(event.type);
      if (set) for (const h of set) h(event.payload, event);
    };
    return () => es.close();
  }, [router, userId]);

  const value = useMemo(() => ({ connected, counts, setCounts, subscribe }), [connected, counts, setCounts, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used inside RealtimeProvider");
  return ctx;
}

/** Subscribe to a realtime event type for the lifetime of the component. */
export function useRealtimeEvent<T extends RealtimeEventType>(type: T, handler: Handler<T>): void {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => subscribe(type, (p, e) => ref.current(p, e)), [subscribe, type]);
}
