import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_PREF, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, dragSidebar, parseSidebarPref, serializeSidebarPref } from "./sidebar";

describe("sidebar cookie", () => {
  it("round-trips width and collapsed state", () => {
    expect(parseSidebarPref(serializeSidebarPref({ width: 280, collapsed: false }))).toEqual({ width: 280, collapsed: false });
    expect(parseSidebarPref(serializeSidebarPref({ width: 312, collapsed: true }))).toEqual({ width: 312, collapsed: true });
  });

  it("falls back to the default for missing or foreign values", () => {
    expect(parseSidebarPref(undefined)).toEqual(DEFAULT_SIDEBAR_PREF);
    expect(parseSidebarPref("wide")).toEqual(DEFAULT_SIDEBAR_PREF);
    expect(parseSidebarPref("-20")).toEqual(DEFAULT_SIDEBAR_PREF);
  });

  it("clamps a tampered width into range", () => {
    expect(parseSidebarPref("9999").width).toBe(SIDEBAR_MAX_WIDTH);
    expect(parseSidebarPref("10c")).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: true });
  });
});

describe("dragSidebar", () => {
  const start = { width: 256, collapsed: false };

  it("follows the pointer within the limits", () => {
    expect(dragSidebar(start, 40)).toEqual({ width: 296, collapsed: false });
    expect(dragSidebar(start, 500)).toEqual({ width: SIDEBAR_MAX_WIDTH, collapsed: false });
  });

  it("stops at the minimum before it snaps into the rail", () => {
    expect(dragSidebar(start, -80)).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: false });
  });

  it("collapses below the threshold and keeps the width the drag started from", () => {
    expect(dragSidebar(start, -150)).toEqual({ width: 256, collapsed: true });
  });

  it("expands out of the rail once dragged past the threshold", () => {
    const rail = { width: 300, collapsed: true };
    expect(dragSidebar(rail, 40)).toEqual({ width: 300, collapsed: true });
    expect(dragSidebar(rail, 100)).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: false });
    expect(dragSidebar(rail, 250)).toEqual({ width: 306, collapsed: false });
  });
});
