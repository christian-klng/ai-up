"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, WifiOff } from "lucide-react";
import type { WhiteboardItem } from "@/lib/structures/types";
import { applyWhiteboardOps, newWhiteboardItemId, type WhiteboardOp } from "@/lib/structures/whiteboard";
import { peerColor, type WhiteboardEvent, type WhiteboardParticipant, type WhiteboardPostBody } from "@/lib/whiteboard-live";
import { UserAvatar } from "@/components/shell/user-avatar";
import { WB_TOAST, WhiteboardEditor, type WhiteboardPeer, type WhiteboardRemoteState } from "./whiteboard-editor";

// Client of a live session (docs/whiteboard.md 5): optimistic local apply,
// ops coalesced per item and sent at most every SEND_MS, remote ops applied
// in seq order. A gap in the sequence or a rejected op re-syncs from a fresh
// snapshot – the server is the truth.

const SEND_MS = 80;
const SELECT_MS = 150;
const LOCK_REFRESH_MS = 10_000;

type Status = "connecting" | "live" | "offline";

export function LiveWhiteboard({ contentId, elementKey, authors, maxUploadMb, onClose }: { contentId: string; elementKey: string; authors?: Record<string, string>; maxUploadMb?: number; onClose: (items: WhiteboardItem[] | null) => void }) {
  const t = useTranslations("knowledge.structured.whiteboard");
  const base = `/api/whiteboards/${contentId}/${elementKey}`;
  const clientId = useMemo(() => newWhiteboardItemId(), []);

  const [items, setItems] = useState<WhiteboardItem[] | null>(null);
  const [me, setMe] = useState<string | undefined>();
  const [people, setPeople] = useState<WhiteboardParticipant[]>([]);
  const [locks, setLocks] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>("connecting");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);

  const itemsRef = useRef<WhiteboardItem[]>([]);
  const seqRef = useRef(0);
  const tokenRef = useRef("");
  /** item id → number of own batches not yet echoed back */
  const pending = useRef(new Map<string, number>());
  const outbox = useRef(new Map<string, WhiteboardOp>());
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const selectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef<string | null>(null);

  const resync = useCallback(() => {
    setStatus("connecting");
    setEpoch((e) => e + 1);
  }, []);
  // The stream effect must not reconnect because a parent re-rendered or a translation function changed.
  const onCloseRef = useRef(onClose);
  const tRef = useRef(t);
  useEffect(() => {
    onCloseRef.current = onClose;
    tRef.current = t;
  }, [onClose, t]);

  const setBoard = (next: WhiteboardItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  const post = useCallback(
    async (body: Omit<WhiteboardPostBody, "token" | "clientId">) => {
      if (!tokenRef.current) return null;
      const res = await fetch(`${base}/ops`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, token: tokenRef.current, clientId } satisfies WhiteboardPostBody) });
      if (res.status === 409 || res.status === 401) {
        resync();
        return null;
      }
      if (!res.ok) throw new Error(`whiteboard ops ${res.status}`);
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
        // Someone holds the item or it is scaffolding – take the server's version.
        for (const id of res.rejected) pending.current.delete(id);
        toast.info(t("rejected"), WB_TOAST);
        resync();
      }
    } catch {
      setStatus("offline");
      resync();
    } finally {
      inFlight.current = false;
      if (outbox.current.size) scheduleSend();
    }
  }, [post, resync, scheduleSend, t]);
  useEffect(() => {
    flushRef.current = flushOutbox;
  }, [flushOutbox]);

  const onOps = useCallback(
    (ops: WhiteboardOp[]) => {
      setBoard(applyWhiteboardOps(itemsRef.current, ops));
      for (const op of ops) {
        const id = op.op === "upsert" ? op.item.id : op.id;
        // one pending mark per id and batch: the outbox coalesces, so count on first entry only
        if (!outbox.current.has(id)) pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
        outbox.current.set(id, op);
      }
      scheduleSend();
    },
    [scheduleSend],
  );

  // Event stream – reopened on every resync (epoch).
  useEffect(() => {
    const es = new EventSource(`${base}/events`);
    es.onmessage = (msg) => {
      let ev: WhiteboardEvent;
      try {
        ev = JSON.parse(msg.data) as WhiteboardEvent;
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
              if (op.op === "upsert" && n <= 0 && !outbox.current.has(id)) setBoard(applyWhiteboardOps(itemsRef.current, [op]));
            }
            return;
          }
          // Remote ops on items with own unconfirmed changes are skipped: ours were applied after them on the server.
          const remote = ev.ops.filter((op) => !pending.current.has(op.op === "upsert" ? op.item.id : op.id));
          setBoard(applyWhiteboardOps(itemsRef.current, remote));
          break;
        }
        case "reset":
          seqRef.current = ev.seq;
          pending.current.clear();
          outbox.current.clear();
          setBoard(ev.items);
          toast.info(tRef.current("wasReset"), WB_TOAST);
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
          toast.error(tRef.current("revoked"), WB_TOAST);
          onCloseRef.current(null);
          break;
      }
    };
    es.onerror = () => setStatus("offline");
    return () => es.close();
  }, [base, clientId, epoch, resync]);

  // Soft lock while typing – refreshed so a long pause does not release it.
  const onEditingChange = useCallback(
    (id: string | null) => {
      editingRef.current = id;
      void post({ editing: id }).then((res) => {
        if (res?.lockDenied) toast.info(t("lockDenied"), WB_TOAST);
      }).catch(() => {});
    },
    [post, t],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (editingRef.current) void post({ editing: editingRef.current }).catch(() => {});
    }, LOCK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [post]);

  const onSelectionChange = useCallback(
    (ids: string[]) => {
      if (selectTimer.current) clearTimeout(selectTimer.current);
      selectTimer.current = setTimeout(() => void post({ select: ids }).catch(() => {}), SELECT_MS);
    },
    [post],
  );

  const remote: WhiteboardRemoteState = useMemo(() => {
    const byUser = new Map(people.map((p) => [p.userId, p]));
    const peer = (userId: string): WhiteboardPeer => ({ userId, name: byUser.get(userId)?.name ?? "…", color: peerColor(userId) });
    const selections: Record<string, WhiteboardPeer[]> = {};
    for (const p of people) {
      if (p.userId === me) continue;
      for (const id of p.selection) (selections[id] ??= []).push(peer(p.userId));
    }
    const lockMap: Record<string, WhiteboardPeer> = {};
    for (const [id, userId] of Object.entries(locks)) if (userId !== me) lockMap[id] = peer(userId);
    return { selections, locks: lockMap };
  }, [people, locks, me]);

  // Author tags also know everyone currently on the board.
  const allAuthors = useMemo(() => ({ ...authors, ...Object.fromEntries(people.map((p) => [p.userId, p.name])) }), [authors, people]);

  const close = useCallback(() => {
    if (outbox.current.size) void flushOutbox();
    onClose(itemsRef.current);
  }, [flushOutbox, onClose]);

  const header = (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1 shadow-sm">
      <span className="flex items-center gap-1 text-xs text-muted-foreground" title={status === "live" ? (savedAt ? t("saved") : t("live")) : status === "offline" ? t("offline") : t("connecting")}>
        {status === "connecting" && <Loader2 className="size-3.5 animate-spin" />}
        {status === "offline" && <WifiOff className="size-3.5 text-destructive" />}
        {status === "live" && (savedAt ? <Check className="size-3.5 text-green-600" /> : <span className="size-2 rounded-full bg-green-500" />)}
        <span className="hidden sm:inline">{status === "live" ? (savedAt ? t("saved") : t("live")) : status === "offline" ? t("offline") : t("connecting")}</span>
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

  if (!items) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <WhiteboardEditor
      items={items}
      onOps={status === "live" ? onOps : undefined}
      meId={me}
      authors={allAuthors}
      remote={remote}
      onSelectionChange={onSelectionChange}
      onEditingChange={onEditingChange}
      maxUploadMb={maxUploadMb}
      headerSlot={header}
      onClose={close}
    />
  );
}
