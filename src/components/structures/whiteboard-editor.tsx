"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Background, Controls, MiniMap, NodeResizer, Panel, ReactFlow, ReactFlowProvider, SelectionMode, useReactFlow, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BringToFront, Circle, Copy, Hand, ImagePlus, Lock, Maximize2, Minimize2, MousePointer2, SendToBack, Square, StickyNote, Trash2, Type, Unlock, UserRound, X } from "lucide-react";
import type { WhiteboardBoard, WhiteboardColor, WhiteboardFontSize, WhiteboardItem } from "@/lib/structures/types";
import { WHITEBOARD_COLORS } from "@/lib/structures/types";
import { WHITEBOARD_DEFAULT_SIZE, WHITEBOARD_MAX_ITEMS, WHITEBOARD_MAX_SIZE, WHITEBOARD_MIN_SIZE, applyWhiteboardOps, newWhiteboardItemId, nextZ, type WhiteboardOp } from "@/lib/structures/whiteboard";
import { uploadFile, type UploadError } from "@/lib/upload-client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Free canvas on React Flow (docs/whiteboard.md). The editor is controlled:
// it renders `items` and reports every change as ops – the form applies them
// locally, the live session sends them to the server first.
// ---------------------------------------------------------------------------

export type WhiteboardPeer = { userId: string; name: string; color: string };
export type WhiteboardRemoteState = {
  /** item id → peers that currently have it selected */
  selections: Record<string, WhiteboardPeer[]>;
  /** item id → peer typing in it (soft lock) */
  locks: Record<string, WhiteboardPeer>;
};

export type WhiteboardEditorProps = {
  items: WhiteboardItem[];
  /** missing = read-only */
  onOps?: (ops: WhiteboardOp[]) => void;
  /** "seed": template editor – may lock/unlock and edit locked items */
  mode?: "fill" | "seed";
  meId?: string;
  /** user id → display name, for the author tags */
  authors?: Record<string, string>;
  remote?: WhiteboardRemoteState;
  onSelectionChange?: (ids: string[]) => void;
  onEditingChange?: (id: string | null) => void;
  maxUploadMb?: number;
  /** extra controls in the top-right corner (e.g. participants) */
  headerSlot?: ReactNode;
  /** overlay mode: always full screen, the corner button closes instead of shrinking */
  onClose?: () => void;
  className?: string;
};

// Full class strings (Tailwind scans for literals).
const STICKY_BG: Record<WhiteboardColor, string> = {
  yellow: "bg-yellow-200 dark:bg-yellow-300",
  orange: "bg-orange-200 dark:bg-orange-300",
  green: "bg-green-200 dark:bg-green-300",
  blue: "bg-sky-200 dark:bg-sky-300",
  purple: "bg-violet-200 dark:bg-violet-300",
  pink: "bg-pink-200 dark:bg-pink-300",
  gray: "bg-zinc-200 dark:bg-zinc-300",
  white: "bg-white dark:bg-zinc-100",
};
const SHAPE_STYLE: Record<WhiteboardColor, string> = {
  yellow: "border-yellow-500/70 bg-yellow-400/10",
  orange: "border-orange-500/70 bg-orange-400/10",
  green: "border-green-500/70 bg-green-400/10",
  blue: "border-sky-500/70 bg-sky-400/10",
  purple: "border-violet-500/70 bg-violet-400/10",
  pink: "border-pink-500/70 bg-pink-400/10",
  gray: "border-zinc-400/80 bg-zinc-400/10",
  white: "border-zinc-300 bg-white/60 dark:border-zinc-600 dark:bg-zinc-900/40",
};
const TEXT_COLOR: Record<WhiteboardColor, string> = {
  yellow: "text-yellow-600 dark:text-yellow-400",
  orange: "text-orange-600 dark:text-orange-400",
  green: "text-green-700 dark:text-green-400",
  blue: "text-sky-700 dark:text-sky-400",
  purple: "text-violet-700 dark:text-violet-400",
  pink: "text-pink-700 dark:text-pink-400",
  gray: "text-zinc-500 dark:text-zinc-400",
  white: "text-foreground",
};
const FONT_SIZE: Record<WhiteboardFontSize, string> = { s: "text-xs", m: "text-sm", l: "text-lg", xl: "text-2xl" };
const DEFAULT_FONT: Record<WhiteboardItem["kind"], WhiteboardFontSize> = { sticky: "m", text: "l", shape: "m", image: "m" };

type WbNode = Node<{ item: WhiteboardItem }, "wb">;

/** Toasts at the bottom: the app's top-right toasts would cover the board's own controls. */
export const WB_TOAST = { position: "bottom-center" as const };

type Ctx = {
  editable: boolean;
  mode: "fill" | "seed";
  meId?: string;
  editingId: string | null;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  setText: (id: string, text: string) => void;
  showAuthors: boolean;
  authors?: Record<string, string>;
  remote?: WhiteboardRemoteState;
  canEdit: (item: WhiteboardItem) => boolean;
};

const WbContext = createContext<Ctx | null>(null);
const useWb = () => useContext(WbContext)!;

function WbNodeView({ id, data, selected }: NodeProps<WbNode>) {
  const t = useTranslations("knowledge.structured.whiteboard");
  const ctx = useWb();
  const item = data.item;
  const editing = ctx.editingId === id;
  const canEdit = ctx.canEdit(item);
  const peers = ctx.remote?.selections[id] ?? [];
  const lock = ctx.remote?.locks[id];
  const ring = lock ?? peers[0];
  const fontSize = FONT_SIZE[item.fontSize ?? DEFAULT_FONT[item.kind]];
  const color = item.color ?? (item.kind === "sticky" ? "yellow" : item.kind === "shape" ? "gray" : "white");
  const author = ctx.showAuthors && item.createdBy ? ctx.authors?.[item.createdBy] : undefined;

  const textArea = (className: string) => (
    <textarea
      autoFocus
      value={item.text ?? ""}
      maxLength={2000}
      onChange={(e) => ctx.setText(id, e.target.value)}
      onBlur={ctx.stopEditing}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) ctx.stopEditing();
      }}
      onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
      className={cn("nodrag nopan nowheel size-full resize-none bg-transparent outline-none", fontSize, className)}
    />
  );

  let body: ReactNode;
  switch (item.kind) {
    case "sticky":
      body = (
        <div className={cn("flex size-full items-center justify-center overflow-hidden rounded-sm p-3 text-center text-zinc-900 shadow-md", STICKY_BG[color])}>
          {editing ? textArea("text-center") : <span className={cn("whitespace-pre-wrap break-words", fontSize, !item.text && "text-zinc-900/40")}>{item.text || (canEdit ? t("emptySticky") : "")}</span>}
        </div>
      );
      break;
    case "text":
      body = <div className={cn("size-full overflow-hidden p-1", TEXT_COLOR[color])}>{editing ? textArea("") : <span className={cn("whitespace-pre-wrap break-words font-medium", fontSize, !item.text && "opacity-40")}>{item.text || (canEdit ? t("emptyText") : "")}</span>}</div>;
      break;
    case "shape":
      body = (
        <div className={cn("flex size-full overflow-hidden border-2 p-3", SHAPE_STYLE[color], item.shape === "ellipse" ? "items-center justify-center rounded-[50%] text-center" : "items-start rounded-lg")}>
          {editing ? textArea(item.shape === "ellipse" ? "text-center" : "font-semibold") : <span className={cn("whitespace-pre-wrap break-words font-semibold", fontSize)}>{item.text}</span>}
        </div>
      );
      break;
    case "image": {
      const src = item.mediaId ? `/api/files/${item.mediaId}` : item.url;
      body = (
        <div className="size-full overflow-hidden rounded-sm bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt={item.alt ?? ""} draggable={false} referrerPolicy={item.url ? "no-referrer" : undefined} className="size-full object-contain" />}
        </div>
      );
      break;
    }
  }

  return (
    <>
      <NodeResizer
        isVisible={selected && canEdit && !editing}
        minWidth={WHITEBOARD_MIN_SIZE}
        minHeight={WHITEBOARD_MIN_SIZE}
        maxWidth={WHITEBOARD_MAX_SIZE}
        maxHeight={WHITEBOARD_MAX_SIZE}
        keepAspectRatio={item.kind === "image"}
        lineClassName="!border-primary"
        handleClassName="!size-2.5 !rounded-sm !border-primary !bg-background"
      />
      <div className={cn("relative size-full", selected && !canEdit && "ring-2 ring-primary/40")} style={ring ? { boxShadow: `0 0 0 2px ${ring.color}`, borderRadius: 6 } : undefined}>
        {body}
        {item.locked && ctx.mode === "seed" && <Lock className="absolute top-1 right-1 size-3 text-muted-foreground" />}
        {author && <span className="pointer-events-none absolute right-1 bottom-0.5 max-w-[90%] truncate text-[10px] text-zinc-900/60">{author}</span>}
        {ring && (
          <span className="pointer-events-none absolute -top-5 left-0 truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: ring.color }}>
            {lock ? t("isTyping", { name: lock.name }) : ring.name}
          </span>
        )}
      </div>
    </>
  );
}

const nodeTypes = { wb: WbNodeView };

function ToolButton({ label, active, onClick, children, disabled, className }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn("inline-flex size-8 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground disabled:opacity-40", active && "bg-accent text-foreground", className)}
    >
      {children}
    </button>
  );
}

function Board({ items, onOps, mode = "fill", meId, authors, remote, onSelectionChange, onEditingChange, maxUploadMb = 25, headerSlot, onClose, className }: WhiteboardEditorProps) {
  const t = useTranslations("knowledge.structured.whiteboard");
  const rf = useReactFlow();
  const { resolvedTheme } = useTheme();
  const editable = Boolean(onOps);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [fullscreenState, setFullscreen] = useState(false);
  const fullscreen = Boolean(onClose) || fullscreenState;
  const [showAuthors, setShowAuthors] = useState(false);
  const [stickyColor, setStickyColor] = useState<WhiteboardColor>("yellow");
  const [uploading, setUploading] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const clipboard = useRef<WhiteboardItem[]>([]);
  const cascade = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const hasAuthors = useMemo(() => items.some((i) => i.createdBy && authors?.[i.createdBy]), [items, authors]);

  const canEdit = useCallback(
    (item: WhiteboardItem) => {
      if (!editable) return false;
      if (item.locked && mode !== "seed") return false;
      const lock = remote?.locks[item.id];
      return !lock || lock.userId === meId;
    },
    [editable, mode, remote, meId],
  );

  const emit = useCallback((ops: WhiteboardOp[]) => {
    if (ops.length) onOps?.(ops);
  }, [onOps]);

  // Selection and editing state follow the items: a deleted or remotely locked item drops out.
  const liveSelected = useMemo(() => selected.filter((id) => byId.has(id)), [selected, byId]);
  const liveEditing = editingId && byId.has(editingId) && canEdit(byId.get(editingId)!) ? editingId : null;
  const selectionKey = liveSelected.join(",");
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onEditingChangeRef = useRef(onEditingChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
    onEditingChangeRef.current = onEditingChange;
  }, [onSelectionChange, onEditingChange]);
  useEffect(() => {
    onSelectionChangeRef.current?.(selectionKey ? selectionKey.split(",") : []);
  }, [selectionKey]);
  useEffect(() => {
    onEditingChangeRef.current?.(liveEditing);
  }, [liveEditing]);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const nodes: WbNode[] = useMemo(
    () =>
      items.map((item) => {
        const itemEditable = canEdit(item);
        // Locked scaffolding lets clicks through: selection boxes and double-clicks start on the pane.
        const passThrough = !editable || (item.locked && mode !== "seed");
        return {
          id: item.id,
          type: "wb" as const,
          position: { x: item.x, y: item.y },
          width: item.w,
          height: item.h,
          // Size is ours, not the DOM's: without `measured` React Flow treats a node as uninitialised.
          measured: { width: item.w, height: item.h },
          zIndex: item.z,
          selected: liveSelected.includes(item.id),
          draggable: itemEditable && liveEditing !== item.id,
          selectable: editable && !passThrough,
          deletable: itemEditable,
          style: passThrough ? { pointerEvents: "none" as const } : undefined,
          data: { item },
        };
      }),
    [items, canEdit, editable, mode, liveSelected, liveEditing],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<WbNode>[]) => {
      const patches = new Map<string, Partial<WhiteboardItem>>();
      const patch = (id: string, p: Partial<WhiteboardItem>) => patches.set(id, { ...patches.get(id), ...p });
      const removed: string[] = [];
      let nextSelected: Set<string> | null = null;
      for (const c of changes) {
        if (c.type === "select") {
          nextSelected ??= new Set(liveSelected);
          if (c.selected) nextSelected.add(c.id);
          else nextSelected.delete(c.id);
          continue;
        }
        if (c.type === "add" || c.type === "replace") continue;
        const item = byId.get(c.id);
        if (!item || !canEdit(item)) continue;
        if (c.type === "position" && c.position) patch(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
        else if (c.type === "dimensions" && c.dimensions && (c.resizing !== undefined || c.setAttributes)) {
          patch(c.id, { w: clampSize(c.dimensions.width), h: clampSize(c.dimensions.height) });
        } else if (c.type === "remove") removed.push(c.id);
      }
      if (nextSelected) setSelected([...nextSelected]);
      const ops: WhiteboardOp[] = [];
      for (const [id, p] of patches) {
        const item = byId.get(id)!;
        const next = { ...item, ...p };
        if (next.x !== item.x || next.y !== item.y || next.w !== item.w || next.h !== item.h) ops.push({ op: "upsert", item: next });
      }
      for (const id of removed) ops.push({ op: "delete", id });
      emit(ops);
    },
    [byId, canEdit, emit, liveSelected],
  );

  const viewportCenter = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const addItem = (partial: Omit<WhiteboardItem, "id" | "x" | "y" | "w" | "h" | "z"> & Partial<Pick<WhiteboardItem, "w" | "h">>, at?: { x: number; y: number }, edit = false) => {
    if (items.length >= WHITEBOARD_MAX_ITEMS) {
      toast.error(t("tooMany", { max: WHITEBOARD_MAX_ITEMS }), WB_TOAST);
      return;
    }
    const size = WHITEBOARD_DEFAULT_SIZE[partial.kind];
    const w = partial.w ?? size.w;
    const h = partial.h ?? size.h;
    let pos = at;
    if (!pos) {
      const c = viewportCenter();
      const offset = (cascade.current++ % 6) * 24;
      pos = { x: c.x + offset, y: c.y + offset };
    }
    // Boxes go to the back so they frame what is already there.
    const z = partial.kind === "shape" ? Math.min(0, ...items.map((i) => i.z)) - 1 : nextZ(items);
    const item: WhiteboardItem = { ...partial, id: newWhiteboardItemId(), x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2), w, h, z, ...(meId && mode !== "seed" ? { createdBy: meId } : {}) };
    emit([{ op: "upsert", item }]);
    setSelected([item.id]);
    if (edit) setEditingId(item.id);
  };

  const selectedItems = liveSelected.map((id) => byId.get(id)).filter((i): i is WhiteboardItem => Boolean(i));
  const editableSelection = selectedItems.filter(canEdit);

  const update = (patch: Partial<WhiteboardItem> | ((item: WhiteboardItem) => Partial<WhiteboardItem>)) => {
    emit(editableSelection.map((item) => ({ op: "upsert", item: stripUndef({ ...item, ...(typeof patch === "function" ? patch(item) : patch) }) })));
  };

  const removeSelection = () => {
    emit(editableSelection.map((i) => ({ op: "delete" as const, id: i.id })));
    setSelected([]);
  };

  const cloneItems = (source: WhiteboardItem[], offset: number) => {
    if (items.length + source.length > WHITEBOARD_MAX_ITEMS) {
      toast.error(t("tooMany", { max: WHITEBOARD_MAX_ITEMS }), WB_TOAST);
      return;
    }
    let z = nextZ(items);
    const clones = source.map((i) => stripUndef({ ...i, id: newWhiteboardItemId(), x: i.x + offset, y: i.y + offset, z: z++, locked: mode === "seed" ? i.locked : undefined, createdBy: meId && mode !== "seed" ? meId : undefined }));
    emit(clones.map((item) => ({ op: "upsert", item })));
    setSelected(clones.map((c) => c.id));
  };

  const toFront = () => {
    let z = nextZ(items);
    emit([...editableSelection].sort((a, b) => a.z - b.z).map((item) => ({ op: "upsert", item: { ...item, z: z++ } })));
  };
  const toBack = () => {
    let z = Math.min(0, ...items.map((i) => i.z)) - editableSelection.length;
    emit([...editableSelection].sort((a, b) => a.z - b.z).map((item) => ({ op: "upsert", item: { ...item, z: z++ } })));
  };

  const uploadImages = async (files: File[], at?: { x: number; y: number }) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length || !editable) return;
    const maxBytes = maxUploadMb * 1024 * 1024;
    setUploading((n) => n + images.length);
    let index = 0;
    for (const file of images) {
      const slot = at ? { x: at.x + index * 24, y: at.y + index * 24 } : undefined;
      index++;
      try {
        if (file.size > maxBytes) throw { code: "too_large" } satisfies UploadError;
        const media = await uploadFile(file, "content");
        if (media.kind !== "image") throw { code: "unsupported_type" } satisfies UploadError;
        const scale = media.width && media.height ? Math.min(1, 400 / Math.max(media.width, media.height)) : 1;
        const w = media.width ? clampSize(media.width * scale) : WHITEBOARD_DEFAULT_SIZE.image.w;
        const h = media.height ? clampSize(media.height * scale) : WHITEBOARD_DEFAULT_SIZE.image.h;
        addItem({ kind: "image", mediaId: media.id, alt: file.name.replace(/\.[^.]+$/, "").slice(0, 500), w, h }, slot);
      } catch (err) {
        const code = (err as UploadError)?.code;
        toast.error(code === "too_large" ? t("imageTooLarge", { mb: maxUploadMb }) : code === "unsupported_type" ? t("imageUnsupported") : t("imageFailed"), WB_TOAST);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      if (liveSelected.length) setSelected([]);
      else if (onClose) onClose();
      else if (fullscreenState) setFullscreen(false);
      return;
    }
    if (!editable) return;
    if (mod && e.key.toLowerCase() === "c" && editableSelection.length) {
      clipboard.current = editableSelection.map((i) => structuredClone(i));
      return;
    }
    if (mod && e.key.toLowerCase() === "d" && editableSelection.length) {
      e.preventDefault();
      cloneItems(editableSelection, 24);
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(items.filter((i) => !(i.locked && mode !== "seed")).map((i) => i.id));
      return;
    }
    if (e.key === "Enter" && editableSelection.length === 1 && editableSelection[0].kind !== "image") {
      e.preventDefault();
      setEditingId(editableSelection[0].id);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!editable || isTyping(e.target)) return;
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void uploadImages(files);
      return;
    }
    if (clipboard.current.length) {
      e.preventDefault();
      cloneItems(clipboard.current, 36);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!editable) return;
    const target = e.target as HTMLElement;
    const nodeEl = target.closest(".react-flow__node");
    if (nodeEl) {
      const item = byId.get(nodeEl.getAttribute("data-id") ?? "");
      if (item && canEdit(item) && item.kind !== "image") {
        setSelected([item.id]);
        setEditingId(item.id);
      }
      return;
    }
    if (!target.closest(".react-flow__pane")) return;
    addItem({ kind: "sticky", color: stickyColor, text: "" }, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), true);
  };

  const ctx: Ctx = {
    editable,
    mode,
    meId,
    editingId: liveEditing,
    startEditing: setEditingId,
    stopEditing: () => setEditingId(null),
    setText: (id, text) => {
      const item = byId.get(id);
      if (item && canEdit(item)) emit([{ op: "upsert", item: { ...item, text } }]);
    },
    showAuthors,
    authors,
    remote,
    canEdit,
  };

  const textSelection = editableSelection.filter((i) => i.kind !== "image");
  const shapeSelection = editableSelection.filter((i) => i.kind === "shape");
  const colorFor = (i: WhiteboardItem) => i.color ?? (i.kind === "sticky" ? "yellow" : i.kind === "shape" ? "gray" : "white");

  return (
    <WbContext.Provider value={ctx}>
      <div
        ref={wrapperRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if (editable && e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!editable || !e.dataTransfer.files.length) return;
          e.preventDefault();
          void uploadImages(Array.from(e.dataTransfer.files), rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        }}
        className={cn("outline-none", fullscreen ? "fixed inset-0 z-50 bg-background" : cn("relative h-[28rem] overflow-hidden rounded-md border bg-background", className))}
      >
        <ReactFlow
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={editable ? onNodesChange : undefined}
          colorMode={resolvedTheme === "dark" ? "dark" : "light"}
          nodesDraggable={editable}
          nodesConnectable={false}
          elementsSelectable={editable}
          selectionOnDrag={editable && tool === "select"}
          selectionMode={SelectionMode.Partial}
          panOnDrag={!editable || tool === "hand" ? true : [1, 2]}
          panOnScroll={fullscreen}
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          preventScrolling={fullscreen}
          minZoom={0.1}
          maxZoom={4}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          multiSelectionKeyCode="Shift"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} position="bottom-right" />
          {fullscreen && <MiniMap pannable zoomable position="bottom-left" className="!hidden sm:!block" />}

          {editable && (
            <Panel position="top-left" className="!m-2 flex flex-col gap-0.5 rounded-lg border bg-card p-1 shadow-sm">
              <ToolButton label={t("toolSelect")} active={tool === "select"} onClick={() => setTool("select")}>
                <MousePointer2 className="size-4" />
              </ToolButton>
              <ToolButton label={t("toolHand")} active={tool === "hand"} onClick={() => setTool("hand")}>
                <Hand className="size-4" />
              </ToolButton>
              <div className="my-0.5 h-px bg-border" />
              <ToolButton label={t("addSticky")} onClick={() => addItem({ kind: "sticky", color: stickyColor, text: "" }, undefined, true)}>
                <StickyNote className="size-4" />
              </ToolButton>
              <ToolButton label={t("addText")} onClick={() => addItem({ kind: "text", text: "" }, undefined, true)}>
                <Type className="size-4" />
              </ToolButton>
              <ToolButton label={t("addRect")} onClick={() => addItem({ kind: "shape", shape: "rect", color: "gray", text: "" }, undefined, true)}>
                <Square className="size-4" />
              </ToolButton>
              <ToolButton label={t("addEllipse")} onClick={() => addItem({ kind: "shape", shape: "ellipse", color: "blue", text: "", w: 320, h: 240 }, undefined, true)}>
                <Circle className="size-4" />
              </ToolButton>
              <ToolButton label={t("addImage")} disabled={uploading > 0} onClick={() => fileInput.current?.click()}>
                <ImagePlus className={cn("size-4", uploading > 0 && "animate-pulse")} />
              </ToolButton>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => {
                  void uploadImages(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </Panel>
          )}

          {editableSelection.length > 0 && (
            <Panel position="top-center" className="!mt-2 flex max-w-[calc(100%-7rem)] flex-wrap items-center gap-0.5 rounded-lg border bg-card p-1 shadow-sm">
              {textSelection.length > 0 && (
                <>
                  {WHITEBOARD_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={t(`colors.${c}`)}
                      aria-label={t(`colors.${c}`)}
                      onClick={() => {
                        update((i) => (i.kind === "image" ? {} : { color: c }));
                        if (editableSelection.some((i) => i.kind === "sticky")) setStickyColor(c);
                      }}
                      className={cn("m-0.5 size-5 rounded-full border border-black/15", STICKY_BG[c], textSelection.every((i) => colorFor(i) === c) && "ring-2 ring-primary ring-offset-1 ring-offset-card")}
                    />
                  ))}
                  <div className="mx-1 h-5 w-px bg-border" />
                  {(["s", "m", "l", "xl"] as const).map((f) => (
                    <ToolButton key={f} label={t(`fontSizes.${f}`)} active={textSelection.every((i) => (i.fontSize ?? DEFAULT_FONT[i.kind]) === f)} onClick={() => update((i) => (i.kind === "image" ? {} : { fontSize: f }))} className="w-7 text-xs font-semibold">
                      {f.toUpperCase()}
                    </ToolButton>
                  ))}
                  <div className="mx-1 h-5 w-px bg-border" />
                </>
              )}
              {shapeSelection.length > 0 && (
                <>
                  <ToolButton label={t("addRect")} active={shapeSelection.every((i) => i.shape !== "ellipse")} onClick={() => update((i) => (i.kind === "shape" ? { shape: "rect" } : {}))}>
                    <Square className="size-4" />
                  </ToolButton>
                  <ToolButton label={t("addEllipse")} active={shapeSelection.every((i) => i.shape === "ellipse")} onClick={() => update((i) => (i.kind === "shape" ? { shape: "ellipse" } : {}))}>
                    <Circle className="size-4" />
                  </ToolButton>
                  <div className="mx-1 h-5 w-px bg-border" />
                </>
              )}
              <ToolButton label={t("toFront")} onClick={toFront}>
                <BringToFront className="size-4" />
              </ToolButton>
              <ToolButton label={t("toBack")} onClick={toBack}>
                <SendToBack className="size-4" />
              </ToolButton>
              <ToolButton label={t("duplicate")} onClick={() => cloneItems(editableSelection, 24)}>
                <Copy className="size-4" />
              </ToolButton>
              {mode === "seed" && (
                <ToolButton label={editableSelection.every((i) => i.locked) ? t("unlock") : t("lock")} active={editableSelection.every((i) => i.locked)} onClick={() => update({ locked: editableSelection.every((i) => i.locked) ? undefined : true })}>
                  {editableSelection.every((i) => i.locked) ? <Lock className="size-4" /> : <Unlock className="size-4" />}
                </ToolButton>
              )}
              <ToolButton label={t("delete")} onClick={removeSelection} className="text-destructive hover:text-destructive">
                <Trash2 className="size-4" />
              </ToolButton>
            </Panel>
          )}

          <Panel position="top-right" className="!m-2 flex items-center gap-1">
            {headerSlot}
            <div className="flex items-center gap-0.5 rounded-lg border bg-card p-1 shadow-sm">
              {hasAuthors && (
                <ToolButton label={showAuthors ? t("hideAuthors") : t("showAuthors")} active={showAuthors} onClick={() => setShowAuthors((v) => !v)}>
                  <UserRound className="size-4" />
                </ToolButton>
              )}
              {onClose ? (
                <ToolButton label={t("close")} onClick={onClose}>
                  <X className="size-4" />
                </ToolButton>
              ) : (
                <ToolButton label={fullscreen ? t("exitFullscreen") : t("fullscreen")} onClick={() => setFullscreen((v) => !v)}>
                  {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </ToolButton>
              )}
            </div>
          </Panel>
        </ReactFlow>

        {editable && items.every((i) => i.locked && mode !== "seed") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-4">
            <p className="rounded-md bg-card/90 px-3 py-1.5 text-center text-xs text-muted-foreground shadow-sm">{t("emptyHint")}</p>
          </div>
        )}
        {editable && fullscreen && items.some((i) => !i.locked || mode === "seed") && (
          <p className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 text-xs text-muted-foreground lg:block">{t("hint")}</p>
        )}
      </div>
    </WbContext.Provider>
  );
}

function clampSize(n: number): number {
  return Math.round(Math.min(WHITEBOARD_MAX_SIZE, Math.max(WHITEBOARD_MIN_SIZE, n)));
}

function stripUndef<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function WhiteboardEditor(props: WhiteboardEditorProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

/** Form field: applies the editor's ops to a local board value. */
export function WhiteboardInput({ value, onChange, mode, meId, authors, maxUploadMb, className }: { value: WhiteboardBoard; onChange: (board: WhiteboardBoard) => void; mode?: "fill" | "seed"; meId?: string; authors?: Record<string, string>; maxUploadMb?: number; className?: string }) {
  // Ops arrive faster than the parent re-renders during a drag – apply them to the latest board.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const onOps = useCallback(
    (ops: WhiteboardOp[]) => {
      const next = { items: applyWhiteboardOps(latest.current.items, ops) };
      latest.current = next;
      onChange(next);
    },
    [onChange],
  );
  return <WhiteboardEditor items={value.items} onOps={onOps} mode={mode} meId={meId} authors={authors} maxUploadMb={maxUploadMb} className={className} />;
}
