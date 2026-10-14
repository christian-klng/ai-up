"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import { Bell, LogOut, Menu, MessageCircle, Settings, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarNav, type SidebarNavProps } from "./sidebar-nav";
import { CommunitySwitcher, type SwitcherCommunity } from "./community-switcher";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { SidebarResizer, writeSidebarCookie } from "./sidebar-resizer";
import { SIDEBAR_RAIL_WIDTH, type SidebarPref } from "@/lib/sidebar";

export type AppShellProps = {
  brand: { name: string; logo: React.ReactNode };
  /** The community being shown plus every other one the account may switch to. */
  community: { current: SwitcherCommunity; all: SwitcherCommunity[]; canCreate: boolean };
  user: { id: string; name: string; email: string; avatarMediaId: string | null; role: "member" | "admin" };
  nav: Omit<SidebarNavProps, "onNavigate">;
  labels: { messages: string; notifications: string; profile: string; admin: string; signOut: string; menu: string; resizeSidebar: string; resizeSidebarHint: string };
  /** Desktop sidebar width from the cookie, so the first render already has it. */
  initialSidebar: SidebarPref;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
};

export function AppShell({ brand, community, user, nav, labels, initialSidebar, signOutAction, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  // Live counters (SSE) – initial values come from the RealtimeProvider rendered by the server shell.
  const { counts } = useRealtime();
  const [sidebarPref, setSidebarPref] = useState(initialSidebar);
  const [dragging, setDragging] = useState(false);

  const changeSidebar = (next: SidebarPref, commit: boolean) => {
    setSidebarPref(next);
    if (commit) writeSidebarCookie(next);
  };

  const toggleSidebar = useEffectEvent(() => changeSidebar({ ...sidebarPref, collapsed: !sidebarPref.collapsed }, true));

  // Cmd/Ctrl+B collapses and expands – except while typing, where it means bold (Tiptap and friends).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "b" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.closest("input, textarea, select, [contenteditable]"))) return;
      e.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (collapsed: boolean) => (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <CommunitySwitcher current={community.current} communities={community.all} canCreate={community.canCreate} logo={brand.logo} collapsed={collapsed} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarNav {...nav} collapsed={collapsed} onNavigate={() => setOpen(false)} />
      </div>
      <div className="border-t border-sidebar-border p-2">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/profile" className="flex justify-center rounded-md py-2 hover:bg-sidebar-accent/70" aria-label={user.name}>
                <UserAvatar user={user} size={28} variant="thumb" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {user.name}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Link href="/profile" className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-sidebar-accent/70" onClick={() => setOpen(false)}>
            <UserAvatar user={user} size={28} variant="thumb" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-svh w-full">
      {/* Sticky, so the edge to drag and the profile at the bottom stay put while the page scrolls. */}
      <aside
        className={cn(
          "sticky top-0 hidden h-svh max-w-[40vw] shrink-0 self-start border-r border-sidebar-border md:block",
          !dragging && "transition-[width] duration-200 ease-out",
        )}
        style={{ width: sidebarPref.collapsed ? SIDEBAR_RAIL_WIDTH : sidebarPref.width }}
      >
        {sidebar(sidebarPref.collapsed)}
        <SidebarResizer pref={sidebarPref} onChange={changeSidebar} onDraggingChange={setDragging} label={labels.resizeSidebar} hint={labels.resizeSidebarHint} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={labels.menu}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">{labels.menu}</SheetTitle>
              {sidebar(false)}
            </SheetContent>
          </Sheet>

          {/* Mobile: brand in the top bar (desktop shows it in the sidebar) */}
          <Link href="/home" className="flex min-w-0 items-center gap-2 md:hidden">
            {brand.logo}
            <span className="truncate font-semibold tracking-tight">{brand.name}</span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="relative" aria-label={labels.messages}>
                  <Link href="/messages">
                    <MessageCircle className="size-5" />
                    {counts.unreadMessages > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background">
                        {counts.unreadMessages > 99 ? "99+" : counts.unreadMessages}
                      </span>
                    )}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{labels.messages}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="relative" aria-label={labels.notifications}>
                  <Link href="/notifications">
                    <Bell className="size-5" />
                    {counts.unreadNotifications > 0 && (
                      <span
                        className={cn(
                          "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background",
                        )}
                      >
                        {counts.unreadNotifications > 99 ? "99+" : counts.unreadNotifications}
                      </span>
                    )}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{labels.notifications}</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label={user.name}>
                  <UserAvatar user={user} size={28} variant="thumb" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate text-sm font-medium">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserRound className="size-4" /> {labels.profile}
                  </Link>
                </DropdownMenuItem>
                {user.role === "admin" && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin">
                      <Settings className="size-4" /> {labels.admin}
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOutAction()}>
                  <LogOut className="size-4" /> {labels.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
