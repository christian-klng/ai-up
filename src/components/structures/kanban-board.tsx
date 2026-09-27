"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, ArrowLeft, ArrowRight, Eye, GripVertical, Maximize2, Minimize2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { KanbanBoard, KanbanColor } from "@/lib/structures/types";
import { KANBAN_COLORS } from "@/lib/structures/types";
import {
  KANBAN_MAX_CARDS,
  KANBAN_MAX_COLUMNS,
  KANBAN_MAX_COLUMN_TITLE,
  KANBAN_MAX_DESCRIPTION,
  KANBAN_MAX_TITLE,
  addCardOp,
  addColumnOp,
  applyKanbanOps,
  deleteColumnOp,
  kanbanToLiveItems,
  liveCards,
  liveColumns,
  liveItemsToKanban,
  moveCardOp,
  moveColumnOp,
  newKanbanId,
  type KanbanLiveCard,
  type KanbanLiveColumn,
  type KanbanLiveItem,
  type KanbanOp,
} from "@/lib/structures/kanban";
import { Markdown } from "@/components/content/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Kanban board (docs/kanban-board.md). The editor is controlled: it renders
// live items and reports every change as ops – the form applies them locally,
// a live session sends them to the server first. Drag and drop via dnd-kit:
// pointer, touch and keyboard (space picks up, enter opens a card).
// ---------------------------------------------------------------------------

export type KanbanBoardEditorProps = {
  items: KanbanLiveItem[];
  /** missing = read-only */
  onOps?: (ops: KanbanOp[]) => void;
  /** template setting: members move and edit cards only */
  lockColumns?: boolean;
  /** "seed": template editor – columns stay editable even when locked for members */
  mode?: "fill" | "seed";
  /** extra controls next to the fullscreen button (e.g. participants) */
  headerSlot?: ReactNode;
  /** live session: card id → who else is editing it (soft lock – read-only here meanwhile) */
  remoteLocks?: Record<string, KanbanPeer>;
  /** live session: the card whose dialog is open for editing, null when it closes */
  onEditingChange?: (cardId: string | null) => void;
  className?: string;
};

export type KanbanPeer = { name: string; color: string };

// Full class strings (Tailwind scans for literals).
const COLOR_STRIP: Record<KanbanColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  blue: "bg-sky-500",
  purple: "bg-violet-500",
  brown: "bg-amber-800 dark:bg-amber-700",
  gray: "bg-zinc-400",
};

/** `keyboard`: the keyboard sensor positions by the dragged node – moving it across columns mid-drag confuses it. */
type DragState = { id: string; kind: "card" | "column"; items: KanbanLiveItem[]; keyboard: boolean };

type Over = NonNullable<DragOverEvent["over"]>;

/** Where a card lands when it is over something in ANOTHER column; null within its own column. */
function crossColumnTarget(items: KanbanLiveItem[], card: KanbanLiveCard, over: Over, activeTop: number | null): { columnId: string; index: number } | null {
  const target = items.find((i) => i.id === over.id);
  if (!target) return null;
  const columnId = target.kind === "column" ? target.id : target.columnId;
  if (columnId === card.columnId) return null;
  const siblings = liveCards(items, columnId);
  if (target.kind === "column") return { columnId, index: siblings.length };
  const below = activeTop !== null && activeTop > over.rect.top + over.rect.height / 2;
  return { columnId, index: siblings.findIndex((c) => c.id === target.id) + (below ? 1 : 0) };
}

/** Cards over columns; a dragged column only ever meets other columns. */
const collision: CollisionDetection = (args) => {
  const typeOf = (id: UniqueIdentifier) => args.droppableContainers.find((c) => c.id === id)?.data.current?.type;
  if (args.active.data.current?.type === "column") {
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === "column") });
  }
  const pointer = pointerWithin(args);
  const hits = pointer.length > 0 ? pointer : rectIntersection(args);
  const card = hits.find((h) => typeOf(h.id) === "card");
  return card ? [card] : hits.slice(0, 1);
};

/**
 * Arrow left/right jump to the neighbouring column (a card lands at its top, a column takes its
 * place); up/down stay with the sortable default. The default alone is built for one list and
 * picks cards of the same column for left/right.
 */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return sortableKeyboardCoordinates(event, args);
  const { active, collisionRect, droppableRects, droppableContainers } = args.context;
  if (!active || !collisionRect) return undefined;
  event.preventDefault();
  const center = collisionRect.left + collisionRect.width / 2;
  let best: { left: number; top: number; distance: number } | null = null;
  for (const container of droppableContainers.getEnabled()) {
    if (container.data.current?.type !== "column" || container.id === active.id) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const mid = rect.left + rect.width / 2;
    if (event.code === "ArrowRight" ? mid <= center + 1 : mid >= center - 1) continue;
    const distance = Math.abs(mid - center);
    if (!best || distance < best.distance) best = { left: rect.left, top: rect.top, distance };
  }
  if (!best) return undefined;
  const isColumn = active.data.current?.type === "column";
  // a card aims just below the column header, onto the first card (or the empty list)
  return { x: best.left + (isColumn ? 0 : 8), y: best.top + (isColumn ? 0 : 36) };
};

export function KanbanBoardEditor({ items, onOps, lockColumns, mode = "fill", headerSlot, remoteLocks, onEditingChange, className }: KanbanBoardEditorProps) {
  const t = useTranslations("knowledge.structured.kanban");
  const dndId = useId();
  const editable = Boolean(onOps);
  const columnsEditable = editable && (mode === "seed" || !lockColumns);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const shown = drag?.items ?? items;
  const columns = liveColumns(shown);
  const cardTotal = items.filter((i) => i.kind === "card").length;
  const openCard = openCardId ? items.find((i): i is KanbanLiveCard => i.kind === "card" && i.id === openCardId) : undefined;
  // someone else editing the card at the moment it opens keeps the dialog read-only for us
  const [openReadOnly, setOpenReadOnly] = useState(false);
  const openCardDialog = (id: string) => {
    const lockedByOther = Boolean(remoteLocks?.[id]);
    setOpenReadOnly(lockedByOther);
    setOpenCardId(id);
    if (editable && !lockedByOther) onEditingChange?.(id);
  };
  const closeCardDialog = () => {
    if (editable && !openReadOnly) onEditingChange?.(null);
    setOpenCardId(null);
  };
  // the open card was deleted by someone else: the dialog is gone, so is our soft lock on it
  const cardGone = Boolean(openCardId && !openCard);
  useEffect(() => {
    if (cardGone && editable && !openReadOnly) onEditingChange?.(null);
  }, [cardGone, editable, openReadOnly, onEditingChange]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    // Enter stays free for opening a card
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      // a cancelled keyboard drag (dnd-kit prevents the default) or an open dialog keeps the full screen
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog]")) setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const emit = (...ops: Array<KanbanOp | null>) => {
    const valid = ops.filter((o): o is KanbanOp => o !== null);
    if (valid.length && onOps) onOps(valid);
  };

  const addCard = (columnId: string, title: string) => {
    if (cardTotal >= KANBAN_MAX_CARDS) {
      toast.error(t("tooManyCards", { max: KANBAN_MAX_CARDS }));
      return false;
    }
    emit(addCardOp(items, columnId, { id: newKanbanId(), title: title.slice(0, KANBAN_MAX_TITLE) }));
    return true;
  };

  const addColumn = (title: string) => {
    emit(addColumnOp(items, { id: newKanbanId(), title: title.slice(0, KANBAN_MAX_COLUMN_TITLE) }));
  };

  const titleOf = (id: UniqueIdentifier) => {
    const item = shown.find((i) => i.id === id);
    return item?.title ?? "";
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.pickedUp", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => (over ? t("dnd.over", { title: titleOf(active.id), target: titleOf(over.id) }) : t("dnd.outside", { title: titleOf(active.id) })),
    onDragEnd: ({ active, over }) => (over ? t("dnd.dropped", { title: titleOf(active.id), target: titleOf(over.id) }) : t("dnd.cancelled", { title: titleOf(active.id) })),
    onDragCancel: ({ active }) => t("dnd.cancelled", { title: titleOf(active.id) }),
  };

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const item = items.find((i) => i.id === active.id);
    if (item) setDrag({ id: item.id, kind: item.kind, items, keyboard: activatorEvent instanceof KeyboardEvent });
  };

  // A card crossing into another column moves there in the preview right away; within a column
  // the sortable strategy animates the gap and the final index is settled on drop.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!drag || drag.kind !== "card" || drag.keyboard || !over) return;
    const cur = drag.items;
    const card = cur.find((i): i is KanbanLiveCard => i.kind === "card" && i.id === active.id);
    if (!card) return;
    const target = crossColumnTarget(cur, card, over, active.rect.current.translated?.top ?? null);
    const op = target && moveCardOp(cur, card.id, target.columnId, target.index);
    if (op) setDrag({ ...drag, items: applyKanbanOps(cur, [op]) });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const d = drag;
    setDrag(null);
    if (!d || !over) return;
    if (d.kind === "column") {
      if (over.id === active.id) return;
      const index = liveColumns(items).findIndex((c) => c.id === over.id);
      if (index >= 0) emit(moveColumnOp(items, String(active.id), index));
      return;
    }
    const card = d.items.find((i): i is KanbanLiveCard => i.kind === "card" && i.id === active.id);
    const original = items.find((i): i is KanbanLiveCard => i.kind === "card" && i.id === active.id);
    if (!card || !original) return;
    if (d.keyboard) {
      // keyboard drags never left their column in the preview – settle a column change here
      const target = crossColumnTarget(items, original, over, active.rect.current.translated?.top ?? null);
      if (target) {
        emit(moveCardOp(items, card.id, target.columnId, target.index));
        return;
      }
    }
    let order = liveCards(d.items, card.columnId).map((c) => c.id);
    const target = d.items.find((i) => i.id === over.id);
    if (target?.kind === "card" && target.columnId === card.columnId && target.id !== card.id) {
      order = arrayMove(order, order.indexOf(card.id), order.indexOf(target.id));
    }
    const index = order.indexOf(card.id);
    const before = liveCards(items, original.columnId).findIndex((c) => c.id === card.id);
    if (card.columnId === original.columnId && index === before) return;
    // index counts the other cards only – exactly what moveCardOp expects
    emit(moveCardOp(items, card.id, card.columnId, index));
  };

  const dragged = drag ? shown.find((i) => i.id === drag.id) : undefined;

  return (
    <div className={cn(fullscreen ? "fixed inset-0 z-50 flex flex-col gap-3 bg-background p-4" : "grid grid-cols-1 gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("cardCount", { count: cardTotal })}</span>
        <div className="flex items-center gap-1">
          {headerSlot}
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")} title={fullscreen ? t("exitFullscreen") : t("fullscreen")} onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("dnd.instructions") } }}
      >
        <div className={cn("flex items-start gap-3 overflow-x-auto pb-2", fullscreen && "min-h-0 flex-1")}>
          <SortableContext items={columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {columns.map((col, ci) => (
              <ColumnView
                key={col.id}
                column={col}
                cards={liveCards(shown, col.id)}
                editable={editable}
                columnsEditable={columnsEditable}
                fullscreen={fullscreen}
                isFirst={ci === 0}
                isLast={ci === columns.length - 1}
                canDelete={deleteColumnOp(items, col.id) !== null}
                composerOpen={composerFor === col.id}
                onOpenComposer={() => setComposerFor(col.id)}
                onCloseComposer={() => setComposerFor(null)}
                onAddCard={(title) => addCard(col.id, title)}
                onRename={(title) => emit({ op: "upsert", item: { ...col, title } })}
                onMove={(delta) => emit(moveColumnOp(items, col.id, ci + delta))}
                onDelete={() => emit(deleteColumnOp(items, col.id))}
                onOpenCard={openCardDialog}
                remoteLocks={remoteLocks}
              />
            ))}
          </SortableContext>

          {columnsEditable && columns.length < KANBAN_MAX_COLUMNS && (
            <div className="w-72 shrink-0">
              {addingColumn ? (
                <InlineComposer
                  placeholder={t("columnTitlePlaceholder")}
                  submitLabel={t("addColumn")}
                  maxLength={KANBAN_MAX_COLUMN_TITLE}
                  singleLine
                  onSubmit={(title) => {
                    addColumn(title);
                    return true;
                  }}
                  onClose={() => setAddingColumn(false)}
                />
              ) : (
                <Button type="button" variant="ghost" className="w-full justify-start bg-muted/40 text-muted-foreground" onClick={() => setAddingColumn(true)}>
                  <Plus className="size-4" /> {t("addColumn")}
                </Button>
              )}
            </div>
          )}
        </div>

        <DragOverlay>
          {dragged?.kind === "card" ? <CardFace card={dragged} className="rotate-2 shadow-lg" /> : null}
          {dragged?.kind === "column" ? (
            <div className="w-72 rounded-lg border bg-muted p-3 text-sm font-semibold shadow-lg">
              {dragged.title} <span className="font-normal text-muted-foreground">({liveCards(shown, dragged.id).length})</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openCard && (
        <CardDialog
          key={openCard.id}
          card={openCard}
          columns={liveColumns(items)}
          editable={editable && !openReadOnly}
          lockedBy={openReadOnly ? remoteLocks?.[openCard.id] : undefined}
          onClose={closeCardDialog}
          onCommit={(next) => {
            const ops: KanbanOp[] = [];
            let item: KanbanLiveCard = next;
            if (next.columnId !== openCard.columnId) {
              const moved = moveCardOp(items, openCard.id, next.columnId, liveCards(items, next.columnId).length);
              if (moved?.op === "upsert" && moved.item.kind === "card") item = { ...next, order: moved.item.order };
            }
            if (JSON.stringify(item) !== JSON.stringify(openCard)) ops.push({ op: "upsert", item });
            emit(...ops);
          }}
          onDelete={() => {
            emit({ op: "delete", id: openCard.id });
            closeCardDialog();
          }}
        />
      )}
    </div>
  );
}

function ColumnView({
  column,
  cards,
  editable,
  columnsEditable,
  fullscreen,
  isFirst,
  isLast,
  canDelete,
  composerOpen,
  onOpenComposer,
  onCloseComposer,
  onAddCard,
  onRename,
  onMove,
  onDelete,
  onOpenCard,
  remoteLocks,
}: {
  column: KanbanLiveColumn;
  cards: KanbanLiveCard[];
  editable: boolean;
  columnsEditable: boolean;
  fullscreen: boolean;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  composerOpen: boolean;
  onOpenComposer: () => void;
  onCloseComposer: () => void;
  onAddCard: (title: string) => boolean;
  onRename: (title: string) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onOpenCard: (id: string) => void;
  remoteLocks?: Record<string, KanbanPeer>;
}) {
  const t = useTranslations("knowledge.structured.kanban");
  // the column stays a drop target for cards even when it cannot be dragged itself
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: column.id, data: { type: "column" }, disabled: { draggable: !columnsEditable, droppable: false } });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex w-72 shrink-0 flex-col rounded-lg bg-muted/60 dark:bg-muted/40", fullscreen && "max-h-full", isDragging && "opacity-40")}
    >
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        {columnsEditable && (
          <button type="button" {...attributes} {...listeners} aria-label={t("dragColumn", { title: column.title })} className="-ml-1 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing">
            <GripVertical className="size-4" />
          </button>
        )}
        {columnsEditable ? <ColumnTitle title={column.title} onRename={onRename} /> : <h3 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{column.title}</h3>}
        <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
        {columnsEditable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("columnMenu", { title: column.title })}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={isFirst} onSelect={() => onMove(-1)}>
                <ArrowLeft className="size-4" /> {t("moveColumnLeft")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isLast} onSelect={() => onMove(1)}>
                <ArrowRight className="size-4" /> {t("moveColumnRight")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canDelete} onSelect={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="size-4" /> {canDelete ? t("deleteColumn") : t("deleteColumnBlocked")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className={cn("flex min-h-3 flex-col gap-2 overflow-y-auto px-2 pb-2", !fullscreen && "max-h-[70vh]")}>
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} editable={editable} lockedBy={remoteLocks?.[card.id]} onOpen={() => onOpenCard(card.id)} />
          ))}
          {cards.length === 0 && !composerOpen && <p className="px-1 py-2 text-center text-xs text-muted-foreground">{t("emptyColumn")}</p>}
        </div>
      </SortableContext>

      {editable && (
        <div className="px-2 pb-2">
          {composerOpen ? (
            <InlineComposer placeholder={t("cardTitlePlaceholder")} submitLabel={t("addCard")} maxLength={KANBAN_MAX_TITLE} onSubmit={onAddCard} onClose={onCloseComposer} />
          ) : (
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={onOpenComposer}>
              <Plus className="size-4" /> {t("addCard")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnTitle({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const t = useTranslations("knowledge.structured.kanban");
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== title) onRename(next);
  };
  return (
    <input
      value={draft ?? title}
      aria-label={t("columnTitle")}
      maxLength={KANBAN_MAX_COLUMN_TITLE}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.stopPropagation();
        }
      }}
      className="min-w-0 flex-1 truncate rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:bg-background/60 focus:bg-background focus:ring-1 focus:ring-ring"
    />
  );
}

function SortableCard({ card, editable, lockedBy, onOpen }: { card: KanbanLiveCard; editable: boolean; lockedBy?: KanbanPeer; onOpen: () => void }) {
  // a card someone else is editing cannot be dragged away under their hands (the server would refuse anyway)
  const draggable = editable && !lockedBy;
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: "card" }, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...(draggable ? listeners : {})}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // space is the drag key (sensor); enter opens
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        } else listeners?.onKeyDown?.(e);
      }}
      className={cn("touch-manipulation rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-40")}
    >
      <CardFace card={card} lockedBy={lockedBy} className={draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} />
    </div>
  );
}

function CardFace({ card, lockedBy, className }: { card: KanbanLiveCard; lockedBy?: KanbanPeer; className?: string }) {
  const t = useTranslations("knowledge.structured.kanban");
  return (
    <div
      className={cn("relative rounded-md border bg-card py-2 pr-2 pl-3 text-sm shadow-xs transition-colors hover:border-primary/40", lockedBy && "ring-2", className)}
      style={lockedBy ? { ["--tw-ring-color" as string]: lockedBy.color } : undefined}
    >
      {card.color && <span aria-hidden className={cn("absolute inset-y-1.5 left-1 w-1 rounded-full", COLOR_STRIP[card.color])} />}
      <div className="break-words whitespace-pre-wrap">{card.title}</div>
      {(card.description || lockedBy) && (
        <div className="mt-1 flex items-center justify-between gap-2">
          {card.description ? <AlignLeft className="size-3.5 text-muted-foreground" aria-label={t("hasDescription")} /> : <span />}
          {lockedBy && (
            <span className="truncate rounded px-1 text-[10px] font-medium text-white" style={{ backgroundColor: lockedBy.color }}>
              {t("isEditing", { name: lockedBy.name })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline "new card" / "new column" field: enter adds and stays open for the next one, escape closes. */
function InlineComposer({ placeholder, submitLabel, maxLength, singleLine, onSubmit, onClose }: { placeholder: string; submitLabel: string; maxLength: number; singleLine?: boolean; onSubmit: (title: string) => boolean; onClose: () => void }) {
  const t = useTranslations("knowledge.structured.kanban");
  const [draft, setDraft] = useState("");
  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    if (onSubmit(title)) setDraft("");
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  const field = singleLine ? (
    <Input autoFocus value={draft} placeholder={placeholder} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} className="h-8 bg-card text-sm" />
  ) : (
    <Textarea autoFocus value={draft} placeholder={placeholder} maxLength={maxLength} rows={2} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} className="min-h-0 resize-none bg-card text-sm" />
  );
  return (
    <div
      className="grid grid-cols-1 gap-1.5"
      onBlur={(e) => {
        // leaving the composer (not just moving between its field and buttons) keeps what was typed
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        const title = draft.trim();
        if (title) onSubmit(title);
        onClose();
      }}
    >
      {field}
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" onClick={submit} disabled={!draft.trim()}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("cancel")} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function CardDialog({ card, columns, editable, lockedBy, onCommit, onDelete, onClose }: { card: KanbanLiveCard; columns: KanbanLiveColumn[]; editable: boolean; lockedBy?: KanbanPeer; onCommit: (card: KanbanLiveCard) => void; onDelete: () => void; onClose: () => void }) {
  const t = useTranslations("knowledge.structured.kanban");
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [color, setColor] = useState<KanbanColor | undefined>(card.color);
  const [columnId, setColumnId] = useState(card.columnId);
  const [preview, setPreview] = useState(!editable || Boolean(card.description));

  const close = () => {
    if (editable) {
      const cleanDescription = description.replace(/\r\n?/g, "\n").trim();
      const next: KanbanLiveCard = { id: card.id, kind: "card", order: card.order, columnId, title: title.trim() || card.title };
      if (cleanDescription) next.description = cleanDescription;
      if (color) next.color = color;
      if (card.createdBy) next.createdBy = card.createdBy;
      onCommit(next);
    }
    onClose();
  };

  const columnTitle = columns.find((c) => c.id === card.columnId)?.title;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="grid max-h-[90vh] grid-cols-1 gap-4 overflow-y-auto sm:max-w-xl">
        <DialogTitle className="sr-only">{t("cardDialogTitle")}</DialogTitle>
        {editable ? (
          <Textarea value={title} onChange={(e) => setTitle(e.target.value)} maxLength={KANBAN_MAX_TITLE} rows={1} aria-label={t("cardTitle")} className="min-h-0 resize-none border-transparent px-1 text-base font-semibold shadow-none focus-visible:border-input" />
        ) : (
          <h2 className="pr-8 text-base font-semibold break-words whitespace-pre-wrap">{card.title}</h2>
        )}
        {columnTitle && !editable && <p className="-mt-3 text-xs text-muted-foreground">{t("inColumn", { column: columnTitle })}</p>}
        {lockedBy && <p className="-mt-2 text-xs font-medium" style={{ color: lockedBy.color }}>{t("isEditingLong", { name: lockedBy.name })}</p>}

        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">{t("description")}</span>
            {editable && (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPreview((v) => !v)}>
                {preview ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />} {preview ? t("editDescription") : t("previewDescription")}
              </Button>
            )}
          </div>
          {preview ? (
            description.trim() ? (
              <div className={cn("rounded-md text-sm", editable && "cursor-text")} onClick={() => editable && setPreview(false)}>
                <Markdown>{description}</Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{editable ? t("noDescriptionEditable") : t("noDescription")}</p>
            )
          ) : (
            <Textarea autoFocus value={description} onChange={(e) => setDescription(e.target.value)} maxLength={KANBAN_MAX_DESCRIPTION} rows={6} placeholder={t("descriptionPlaceholder")} className="text-sm" />
          )}
        </div>

        {editable && (
          <>
            <div className="grid grid-cols-1 gap-1.5">
              <span className="text-xs font-medium">{t("color")}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setColor(undefined)}
                  aria-label={t("noColor")}
                  title={t("noColor")}
                  className={cn("flex size-6 items-center justify-center rounded-full border text-muted-foreground", !color && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
                >
                  <X className="size-3" />
                </button>
                {KANBAN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={t(`colors.${c}`)}
                    title={t(`colors.${c}`)}
                    aria-pressed={color === c}
                    className={cn("size-6 rounded-full border border-black/10", COLOR_STRIP[c], color === c && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
                  />
                ))}
              </div>
            </div>

            <label className="grid grid-cols-1 gap-1.5 text-xs font-medium">
              {t("column")}
              <Select value={columnId} onValueChange={setColumnId}>
                <SelectTrigger className="h-8 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm(t("deleteCardConfirm"))) onDelete();
                }}
              >
                <Trash2 className="size-4" /> {t("deleteCard")}
              </Button>
              <Button type="button" size="sm" onClick={close}>
                {t("done")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Form field: keeps the live form of the board locally and reports the stored form. The value
 * coming back from the parent is the one just reported, so the local order keys survive; only a
 * board changed from outside (e.g. a template upgrade) is loaded afresh.
 */
export function KanbanInput({ value, onChange, lockColumns, mode, className }: { value: KanbanBoard; onChange: (board: KanbanBoard) => void; lockColumns?: boolean; mode?: "fill" | "seed"; className?: string }) {
  const [state, setState] = useState(() => ({ source: value, board: value, items: kanbanToLiveItems(value) }));
  const external = value !== state.source && JSON.stringify(value) !== JSON.stringify(state.board);
  if (external) setState({ source: value, board: value, items: kanbanToLiveItems(value) });
  const items = external ? kanbanToLiveItems(value) : state.items;

  const onOps = (ops: KanbanOp[]) => {
    const nextItems = applyKanbanOps(items, ops);
    const board = liveItemsToKanban(nextItems);
    setState({ source: board, board, items: nextItems });
    onChange(board);
  };

  return <KanbanBoardEditor items={items} onOps={onOps} lockColumns={lockColumns} mode={mode} className={className} />;
}

/** Read-only board for the entry view. */
export function KanbanView({ board }: { board: KanbanBoard }) {
  const items = useMemo(() => kanbanToLiveItems(board), [board]);
  return <KanbanBoardEditor items={items} />;
}
