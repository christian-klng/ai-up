"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, LogOut, Menu, MessageCircle, Settings, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarNav, type SidebarNavProps } from "./sidebar-nav";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/components/realtime/realtime-provider";

export type AppShellProps = {
  brand: { name: string; logo: React.ReactNode };
  user: { id: string; name: string; email: string; avatarMediaId: string | null; role: "member" | "admin" };
  nav: Omit<SidebarNavProps, "onNavigate">;
  labels: { messages: string; notifications: string; profile: string; admin: string; signOut: string; menu: string };
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
};

export function AppShell({ brand, user, nav, labels, signOutAction, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  // Live counters (SSE) – initial values come from the RealtimeProvider rendered by the server shell.
  const { counts } = useRealtime();

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Link href="/home" className="flex items-center gap-2.5 px-4 py-4" onClick={() => setOpen(false)}>
        {brand.logo}
        <span className="truncate font-semibold tracking-tight">{brand.name}</span>
      </Link>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav {...nav} onNavigate={() => setOpen(false)} />
      </div>
      <div className="border-t border-sidebar-border p-2">
        <Link href="/profile" className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-sidebar-accent/70" onClick={() => setOpen(false)}>
          <UserAvatar user={user} size={28} variant="thumb" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-svh w-full">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border md:block">{sidebar}</aside>

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
              {sidebar}
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
