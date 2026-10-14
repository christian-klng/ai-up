"use client";

import { useRef } from "react";
import { SIDEBAR_COOKIE, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RAIL_WIDTH, clampSidebarWidth, dragSidebar, serializeSidebarPref, type SidebarPref } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

const KEY_STEP = 16;

export function writeSidebarCookie(pref: SidebarPref) {
  document.cookie = `${SIDEBAR_COOKIE}=${serializeSidebarPref(pref)}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The draggable right edge of the desktop sidebar. Reports every intermediate width with
 * `commit: false` (render only) and the final one with `commit: true` (persist).
 */
export function SidebarResizer({
  pref,
  onChange,
  onDraggingChange,
  label,
  hint,
}: {
  pref: SidebarPref;
  onChange: (next: SidebarPref, commit: boolean) => void;
  onDraggingChange: (dragging: boolean) => void;
  label: string;
  hint: string;
}) {
  const drag = useRef<{ x: number; start: SidebarPref; last: SidebarPref } | null>(null);

  const end = (el: HTMLElement, pointerId: number) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    onDraggingChange(false);
    onChange(d.last, true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const width = pref.collapsed ? SIDEBAR_RAIL_WIDTH : pref.width;
    let next: SidebarPref | null = null;
    if (e.key === "Enter" || e.key === " ") next = { ...pref, collapsed: !pref.collapsed };
    else if (e.key === "ArrowRight") next = pref.collapsed ? { ...pref, collapsed: false } : { width: clampSidebarWidth(width + KEY_STEP), collapsed: false };
    else if (e.key === "ArrowLeft") next = pref.width <= SIDEBAR_MIN_WIDTH ? { ...pref, collapsed: true } : { width: clampSidebarWidth(width - KEY_STEP), collapsed: pref.collapsed };
    if (!next) return;
    e.preventDefault();
    onChange(next, true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={SIDEBAR_RAIL_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={pref.collapsed ? SIDEBAR_RAIL_WIDTH : pref.width}
      tabIndex={0}
      title={hint}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, start: pref, last: pref };
        // The pointer leaves the handle while dragging fast – keep the cursor and stop text selection everywhere.
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        onDraggingChange(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const next = dragSidebar(d.start, e.clientX - d.x);
        if (next.width === d.last.width && next.collapsed === d.last.collapsed) return;
        d.last = next;
        onChange(next, false);
      }}
      onPointerUp={(e) => end(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => end(e.currentTarget, e.pointerId)}
      onDoubleClick={() => onChange({ ...pref, collapsed: !pref.collapsed }, true)}
      onKeyDown={onKeyDown}
      className={cn(
        "group/resizer absolute inset-y-0 -right-1.5 z-40 w-3 cursor-col-resize touch-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-primary after:opacity-0 after:transition-opacity",
        "hover:after:opacity-60 focus-visible:after:opacity-100 active:after:opacity-100",
      )}
    />
  );
}
