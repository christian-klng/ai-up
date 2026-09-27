"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { KanbanBoard } from "@/lib/structures/types";
import { applyKanbanOps, kanbanHasContent, kanbanToLiveItems, type KanbanLiveItem } from "@/lib/structures/kanban";
import { LiveBoardStatus, useLiveBoard, useRemoteLocks, type LiveNotice } from "./live-board";

const KanbanBoardEditor = dynamic(() => import("./kanban-board").then((m) => m.KanbanBoardEditor), { ssr: false });

/** Toasts at the bottom, like the whiteboard: top-right ones would cover the full-screen button. */
const KANBAN_TOAST = { position: "bottom-center" as const };

/**
 * A kanban board on the entry page (docs/kanban-board.md 5). With `live` everyone allowed joins the
 * session right away – no "open" step, the board is edited where it is shown, like Trello. Until the
 * snapshot arrives (and after access ends) the saved board is shown read-only.
 */
export function KanbanSection({ label, elementKey, board, lockColumns, live }: { label: string; elementKey: string; board: KanbanBoard; lockColumns?: boolean; live?: { contentId: string } }) {
  if (!live && !kanbanHasContent(board)) return null;
  return (
    <section>
      <h2 className="mb-1.5 text-base font-semibold">{label}</h2>
      {live ? <LiveKanban contentId={live.contentId} elementKey={elementKey} board={board} lockColumns={lockColumns} /> : <SavedKanban board={board} />}
    </section>
  );
}

function SavedKanban({ board }: { board: KanbanBoard }) {
  const items = useMemo(() => kanbanToLiveItems(board), [board]);
  return <KanbanBoardEditor items={items} />;
}

function LiveKanban({ contentId, elementKey, board, lockColumns }: { contentId: string; elementKey: string; board: KanbanBoard; lockColumns?: boolean }) {
  const t = useTranslations("knowledge.structured.kanban");
  const [revoked, setRevoked] = useState(false);
  const saved = useMemo(() => kanbanToLiveItems(board, { lockColumns }), [board, lockColumns]);

  const onNotice = useCallback(
    (notice: LiveNotice) => {
      if (notice === "rejected") toast.info(t("rejected"), KANBAN_TOAST);
      else if (notice === "reset") toast.info(t("wasReset"), KANBAN_TOAST);
      else if (notice === "lockDenied") toast.info(t("lockDenied"), KANBAN_TOAST);
      else {
        toast.error(t("revoked"), KANBAN_TOAST);
        setRevoked(true);
      }
    },
    [t],
  );
  const live = useLiveBoard<KanbanLiveItem>({ contentId, elementKey, apply: applyKanbanOps, onNotice });
  const remoteLocks = useRemoteLocks(live.people, live.locks, live.me);

  const items = revoked ? saved : (live.items ?? saved);
  const editable = !revoked && live.items !== null && live.status === "live";

  return (
    <KanbanBoardEditor
      items={items}
      onOps={editable ? live.onOps : undefined}
      lockColumns={lockColumns}
      remoteLocks={remoteLocks}
      onEditingChange={live.setEditing}
      headerSlot={revoked ? undefined : <LiveBoardStatus status={live.status} savedAt={live.savedAt} people={live.people} labels={{ live: t("live"), saved: t("saved"), offline: t("offline"), connecting: t("connecting") }} />}
    />
  );
}
