/**
 * Width of the desktop sidebar, chosen by dragging its edge. Kept in a cookie (per device, not per
 * account – screens differ) so the server renders the right width straight away, without a jump.
 * Pure on purpose: read by the server shell, written by the client.
 */
export const SIDEBAR_COOKIE = "aiup_sidebar";

export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
/** Collapsed: a narrow rail with icons only. */
export const SIDEBAR_RAIL_WIDTH = 56;
/** Dragged below this, the sidebar snaps into the rail. */
export const SIDEBAR_COLLAPSE_AT = 140;

/** `width` is the expanded width – it survives collapsing, so expanding returns to it. */
export type SidebarPref = { width: number; collapsed: boolean };

export const DEFAULT_SIDEBAR_PREF: SidebarPref = { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

/** Cookie value: the width, with a trailing `c` when collapsed (`256`, `280c`). */
export function serializeSidebarPref(pref: SidebarPref): string {
  return `${clampSidebarWidth(pref.width)}${pref.collapsed ? "c" : ""}`;
}

export function parseSidebarPref(raw: string | undefined): SidebarPref {
  const m = raw?.match(/^(\d{1,4})(c?)$/);
  if (!m) return DEFAULT_SIDEBAR_PREF;
  return { width: clampSidebarWidth(Number(m[1])), collapsed: m[2] === "c" };
}

/**
 * Where a drag ends up: `startWidth` is what was on screen when the drag began, `dx` how far the
 * pointer has moved since. Collapsing keeps the width the drag started from, so expanding again
 * returns there instead of to the minimum the pointer passed on its way into the rail.
 */
export function dragSidebar(start: SidebarPref, dx: number): SidebarPref {
  const startWidth = start.collapsed ? SIDEBAR_RAIL_WIDTH : start.width;
  const raw = startWidth + dx;
  if (raw < SIDEBAR_COLLAPSE_AT) return { width: start.width, collapsed: true };
  return { width: clampSidebarWidth(raw), collapsed: false };
}
