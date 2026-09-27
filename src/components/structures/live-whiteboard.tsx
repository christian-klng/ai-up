"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { WhiteboardItem } from "@/lib/structures/types";
import { applyWhiteboardOps } from "@/lib/structures/whiteboard";
import { peerColor } from "@/lib/whiteboard-live";
import { LiveBoardStatus, useLiveBoard, type LiveNotice } from "./live-board";
import { WB_TOAST, WhiteboardEditor, type WhiteboardPeer, type WhiteboardRemoteState } from "./whiteboard-editor";

// Live whiteboard session (docs/whiteboard.md 5) – the session itself lives in
// useLiveBoard; this adds selections, soft locks and author tags.

export function LiveWhiteboard({ contentId, elementKey, authors, maxUploadMb, onClose }: { contentId: string; elementKey: string; authors?: Record<string, string>; maxUploadMb?: number; onClose: (items: WhiteboardItem[] | null) => void }) {
  const t = useTranslations("knowledge.structured.whiteboard");

  const onNotice = useCallback(
    (notice: LiveNotice) => {
      if (notice === "rejected") toast.info(t("rejected"), WB_TOAST);
      else if (notice === "reset") toast.info(t("wasReset"), WB_TOAST);
      else if (notice === "lockDenied") toast.info(t("lockDenied"), WB_TOAST);
      else {
        toast.error(t("revoked"), WB_TOAST);
        onClose(null);
      }
    },
    [t, onClose],
  );
  const live = useLiveBoard<WhiteboardItem>({ contentId, elementKey, apply: applyWhiteboardOps, onNotice });
  const { people, locks, me } = live;

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

  const { finish } = live;
  const close = useCallback(() => onClose(finish()), [finish, onClose]);

  if (!live.items) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <WhiteboardEditor
      items={live.items}
      onOps={live.status === "live" ? live.onOps : undefined}
      meId={me}
      authors={allAuthors}
      remote={remote}
      onSelectionChange={live.setSelection}
      onEditingChange={live.setEditing}
      maxUploadMb={maxUploadMb}
      headerSlot={<LiveBoardStatus status={live.status} savedAt={live.savedAt} people={people} labels={{ live: t("live"), saved: t("saved"), offline: t("offline"), connecting: t("connecting") }} />}
      onClose={close}
    />
  );
}
