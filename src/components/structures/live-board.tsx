"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, WifiOff } from "lucide-react";
import type { LiveItem } from "@/lib/structures/live-boards";
import { peerColor, type LiveOp, type WhiteboardEvent, type WhiteboardParticipant, type WhiteboardPostBody } from "@/lib/whiteboard-live";
import { UserAvatar } from "@/components/shell/user-avatar";

// Client of a live board session (docs/whiteboard.md 5), shared by whiteboards
// and kanban boards: optimistic local apply, ops coalesced per item and sent at
// most every SEND_MS, remote ops applied in seq order. A gap in the sequence or
// a rejected op re-syncs from a fresh snapshot – the server is the truth.

const SEND_MS = 80;
const SELECT_MS = 150;
const LOCK_REFRESH_MS = 10_000;

export type LiveStatus = "connecting" | "live" | "offline";
/** What the board shows as a toast – texts and placement are the board's business. */
export type LiveNotice = "rejected" | "reset" | "revoked" | "lockDenied";

export function useLiveBoard<I extends LiveItem>({ contentId, elementKey, apply, onNotice }: { contentId: string; elementKey: string; apply: (items: I[], ops: LiveOp<I>[]) => I[]; onNotice: (notice: LiveNotice) => void }) {
  const base = `/api/whiteboards/${contentId}/${elementKey}`;
  const [clientId] = useState(() => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

  const [items, setItems] = useState<I[] | null>(null);
  const [me, setMe] = useState<string | undefined>();
  const [people, setPeople] = useState<WhiteboardParticipant[]>([]);
  const [locks, setLocks] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);

  const itemsRef = useRef<I[]>([]);
  const seqRef = useRef(0);
  const tokenRef = useRef("");
  /** item id → number of own batches not yet echoed back */
  const pending = useRef(new Map<string, number>());
  const outbox = useRef(new Map<string, LiveOp<I>>());
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const selectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef<string | null>(null);

  const resync = useCallback(() => {
    setStatus("connecting");
    setEpoch((e) => e + 1);
  }, []);
  // The stream effect must not reconnect because a parent re-rendered or a callback changed.
  const onNoticeRef = useRef(onNotice);
  const applyRef = useRef(apply);
  useEffect(() => {
    onNoticeRef.current = onNotice;
    applyRef.current = apply;
  }, [onNotice, apply]);

  const setBoard = useCallback((next: I[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const post = useCallback(
    async (body: Omit<WhiteboardPostBody<I>, "token" | "clientId">) => {
      if (!tokenRef.current) return null;
      const res = await fetch(`${base}/ops`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, token: tokenRef.current, clientId } satisfies WhiteboardPostBody<I>) });
      if (res.status === 409 || res.status === 401) {
        resync();
        return null;
      }
      if (!res.ok) throw new Error(`live board ops ${res.status}`);
      return (await res.json()) as { seq?: number; rejected: string[]; lockDenied: boolean };
    },
    [base, clientId, resync],
  );

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const scheduleSend = useCallback(() => {
    if (!sendTimer.current) sendTimer.current = setTimeout(() => void flushRef.current(), SEND_MS);
  }, []);

  const flushOutbox = useCallback(async () => {
    sendTimer.current = null;
    if (inFlight.current || outbox.current.size === 0) return;
    const ops = [...outbox.current.values()];
    outbox.current.clear();
    inFlight.current = true;
    try {
      const res = await post({ ops });
      if (res?.rejected.length) {
        // Someone holds the item, it is scaffolding or a limit is reached – take the server's version.
        for (const id of res.rejected) pending.current.delete(id);
        onNoticeRef.current("rejected");
        resync();
      }
    } catch {
      setStatus("offline");
      resync();
    } finally {
      inFlight.current = false;
      if (outbox.current.size) scheduleSend();
    }
  }, [post, resync, scheduleSend]);
  useEffect(() => {
    flushRef.current = flushOutbox;
  }, [flushOutbox]);

  const onOps = useCallback(
    (ops: LiveOp<I>[]) => {
      setBoard(applyRef.current(itemsRef.current, ops));
      for (const op of ops) {
        const id = op.op === "upsert" ? op.item.id : op.id;
        // one pending mark per id and batch: the outbox coalesces, so count on first entry only
        if (!outbox.current.has(id)) pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
        outbox.current.set(id, op);
      }
      scheduleSend();
    },
    [scheduleSend, setBoard],
  );

  // Event stream – reopened on every resync (epoch).
  useEffect(() => {
    const es = new EventSource(`${base}/events`);
    es.onmessage = (msg) => {
      let ev: WhiteboardEvent<I>;
      try {
        ev = JSON.parse(msg.data) as WhiteboardEvent<I>;
      } catch {
        return;
      }
      switch (ev.t) {
        case "snapshot":
          seqRef.current = ev.seq;
          pending.current.clear();
          outbox.current.clear();
          tokenRef.current = ev.token;
          setMe(ev.me);
          setPeople(ev.participants);
          setLocks(ev.locks);
          setBoard(ev.items);
          setStatus("live");
          break;
        case "ops": {
          if (ev.seq !== seqRef.current + 1) {
            resync();
            return;
          }
          seqRef.current = ev.seq;
          if (ev.clientId === clientId) {
            for (const op of ev.ops) {
              const id = op.op === "upsert" ? op.item.id : op.id;
              const n = (pending.current.get(id) ?? 1) - 1;
              if (n <= 0) pending.current.delete(id);
              else pending.current.set(id, n);
              // the server stamped authorship – take its version unless a newer local change waits
              if (op.op === "upsert" && n <= 0 && !outbox.current.has(id)) setBoard(applyRef.current(itemsRef.current, [op]));
            }
            return;
          }
          // Remote ops on items with own unconfirmed changes are skipped: ours were applied after them on the server.
          const remote = ev.ops.filter((op) => !pending.current.has(op.op === "upsert" ? op.item.id : op.id));
          setBoard(applyRef.current(itemsRef.current, remote));
          break;
        }
        case "reset":
          seqRef.current = ev.seq;
          pending.current.clear();
          outbox.current.clear();
          setBoard(ev.items);
          onNoticeRef.current("reset");
          break;
        case "presence":
          setPeople(ev.participants);
          break;
        case "select":
          setPeople((ps) => ps.map((p) => (p.userId === ev.userId ? { ...p, selection: ev.ids } : p)));
          break;
        case "lock":
          setLocks((l) => {
            const next = { ...l };
            if (ev.on) next[ev.id] = ev.userId;
            else if (next[ev.id] === ev.userId) delete next[ev.id];
            return next;
          });
          break;
        case "flushed":
          setSavedAt(Date.now());
          break;
        case "token":
          tokenRef.current = ev.token;
          break;
        case "revoked":
          es.close();
          onNoticeRef.current("revoked");
          break;
      }
    };
    es.onerror = () => setStatus("offline");
    return () => es.close();
  }, [base, clientId, epoch, resync, setBoard]);

  // Soft lock while typing – refreshed so a long pause does not release it.
  const setEditing = useCallback(
    (id: string | null) => {
      editingRef.current = id;
      void post({ editing: id })
        .then((res) => {
          if (res?.lockDenied) onNoticeRef.current("lockDenied");
        })
        .catch(() => {});
    },
    [post],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (editingRef.current) void post({ editing: editingRef.current }).catch(() => {});
    }, LOCK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [post]);

  const setSelection = useCallback(
    (ids: string[]) => {
      if (selectTimer.current) clearTimeout(selectTimer.current);
      selectTimer.current = setTimeout(() => void post({ select: ids }).catch(() => {}), SELECT_MS);
    },
    [post],
  );

  /** Sends what is still queued and returns the board as it is now (closing a board). */
  const finish = useCallback(() => {
    if (outbox.current.size) void flushOutbox();
    return itemsRef.current;
  }, [flushOutbox]);

  return { items, me, people, locks, status, savedAt, onOps, setEditing, setSelection, finish };
}

/** Peer name and colour for every item someone else holds a soft lock on. */
export function useRemoteLocks(people: WhiteboardParticipant[], locks: Record<string, string>, me: string | undefined) {
  return useMemo(() => {
    const names = new Map(people.map((p) => [p.userId, p.name]));
    const out: Record<string, { userId: string; name: string; color: string }> = {};
    for (const [id, userId] of Object.entries(locks)) if (userId !== me) out[id] = { userId, name: names.get(userId) ?? "…", color: peerColor(userId) };
    return out;
  }, [people, locks, me]);
}

/** Connection state plus the avatars of everyone on the board. */
export function LiveBoardStatus({ status, savedAt, people, labels }: { status: LiveStatus; savedAt: number | null; people: WhiteboardParticipant[]; labels: { live: string; saved: string; offline: string; connecting: string } }) {
  const text = status === "live" ? (savedAt ? labels.saved : labels.live) : status === "offline" ? labels.offline : labels.connecting;
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1 shadow-sm">
      <span className="flex items-center gap-1 text-xs text-muted-foreground" title={text}>
        {status === "connecting" && <Loader2 className="size-3.5 animate-spin" />}
        {status === "offline" && <WifiOff className="size-3.5 text-destructive" />}
        {status === "live" && (savedAt ? <Check className="size-3.5 text-green-600" /> : <span className="size-2 rounded-full bg-green-500" />)}
        <span className="hidden sm:inline">{text}</span>
      </span>
      <div className="flex -space-x-1.5" title={people.map((p) => p.name).join(", ")}>
        {people.slice(0, 6).map((p) => (
          <span key={p.userId} className="rounded-full ring-2" style={{ ["--tw-ring-color" as string]: peerColor(p.userId) }}>
            <UserAvatar user={{ name: p.name, avatarMediaId: p.avatarMediaId }} size={24} variant="thumb" />
          </span>
        ))}
        {people.length > 6 && <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card">+{people.length - 6}</span>}
      </div>
    </div>
  );
}
