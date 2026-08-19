"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarClock, Home, Settings, Users, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AreaIcon } from "@/components/knowledge/area-icon";

export type NavArea = { id: string; name: string; slug: string; icon?: string; live?: boolean };

export type SidebarNavProps = {
  labels: {
    home: string;
    knowledge: string;
    members: string;
    meetings: string;
    workflows: string;
    admin: string;
    noAreasYet: string;
    noSpacesYet: string;
  };
  knowledgeAreas: NavArea[];
  meetingSpaces: NavArea[];
  isAdmin: boolean;
  onNavigate?: () => void;
};

const ICONS = { home: Home, knowledge: BookOpen, members: Users, meetings: CalendarClock, workflows: Workflow, admin: Settings } satisfies Record<string, LucideIcon>;
type IconKey = keyof typeof ICONS;

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ href, icon, areaIcon, live, active, onNavigate, children }: { href: string; icon?: IconKey; areaIcon?: string; live?: boolean; active: boolean; onNavigate?: () => void; children: React.ReactNode }) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0 opacity-80" aria-hidden /> : areaIcon ? <AreaIcon icon={areaIcon} className="size-4 shrink-0 opacity-70" aria-hidden /> : <span className="size-4 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
      {live && (
        <span className="ml-auto inline-flex items-center" aria-label="live">
          <span className="size-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_0_3px_rgba(16,185,129,0.25)]" />
        </span>
      )}
    </Link>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export function SidebarNav({ labels, knowledgeAreas, meetingSpaces, isAdmin, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const item = (href: string, icon: IconKey | undefined, label: string, live?: boolean, areaIcon?: string) => (
    <NavItem key={href} href={href} icon={icon} areaIcon={areaIcon} live={live} active={isActivePath(pathname, href)} onNavigate={onNavigate}>
      {label}
    </NavItem>
  );

  return (
    <nav className="grid gap-0.5 px-2 pb-6" aria-label="Main">
      {item("/", "home", labels.home)}

      <NavSection title={labels.knowledge}>
        {knowledgeAreas.length === 0 && <p className="px-2.5 py-1 text-xs text-muted-foreground">{labels.noAreasYet}</p>}
        {knowledgeAreas.map((a) => item(`/knowledge/${a.slug}`, undefined, a.name, false, a.icon))}
      </NavSection>

      <NavSection title={labels.meetings}>
        {meetingSpaces.length === 0 && <p className="px-2.5 py-1 text-xs text-muted-foreground">{labels.noSpacesYet}</p>}
        {meetingSpaces.map((s) => item(`/meetings/${s.slug}`, undefined, s.name, s.live))}
      </NavSection>

      <div className="grid gap-0.5 pt-4">
        {item("/members", "members", labels.members)}
        {item("/workflows", "workflows", labels.workflows)}
        {isAdmin && item("/admin", "admin", labels.admin)}
      </div>
    </nav>
  );
}
