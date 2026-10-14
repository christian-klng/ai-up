"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Bot, CalendarClock, Home, Settings, Users, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type NavArea = { id: string; name: string; slug: string; icon?: string; live?: boolean };
export type NavAgent = { id: string; name: string; slug: string; avatarMediaId: string | null };

export type SidebarNavProps = {
  labels: {
    home: string;
    knowledge: string;
    members: string;
    meetings: string;
    workflows: string;
    agents: string;
    admin: string;
    noAreasYet: string;
    noSpacesYet: string;
    /** status hint for a meeting space with a meeting running right now */
    live: string;
  };
  knowledgeAreas: NavArea[];
  meetingSpaces: NavArea[];
  agents: NavAgent[];
  isAdmin: boolean;
  /** icon rail: no labels or headings, names in tooltips, status hints as dots on the icon */
  collapsed?: boolean;
  onNavigate?: () => void;
};

const ICONS = { home: Home, knowledge: BookOpen, members: Users, meetings: CalendarClock, workflows: Workflow, agents: Bot, admin: Settings } satisfies Record<string, LucideIcon>;
type IconKey = keyof typeof ICONS;

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Status hint next to an entry (today: a meeting is running). In the rail it sits on the icon's
 * corner instead, so collapsing the sidebar never hides it.
 */
function NavStatusDot({ label, onIcon }: { label: string; onIcon?: boolean }) {
  return (
    <span className={onIcon ? "absolute -right-1 -top-1 flex" : "ml-auto inline-flex items-center"} role="img" aria-label={label}>
      <span
        className={cn(
          "size-2 rounded-full bg-emerald-500 animate-pulse",
          onIcon ? "ring-2 ring-sidebar" : "shadow-[0_0_0_3px_rgba(16,185,129,0.25)]",
        )}
      />
    </span>
  );
}

function NavItem({
  href,
  icon,
  areaIcon,
  avatarMediaId,
  live,
  liveLabel,
  active,
  collapsed,
  onNavigate,
  children,
}: {
  href: string;
  icon?: IconKey;
  areaIcon?: string;
  /** agents show their picture instead of an icon */
  avatarMediaId?: string | null;
  live?: boolean;
  liveLabel: string;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  children: string;
}) {
  const Icon = icon ? ICONS[icon] : null;
  const glyph = Icon ? (
    <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
  ) : areaIcon ? (
    <AreaIcon icon={areaIcon} className="size-4 shrink-0 opacity-70" aria-hidden />
  ) : avatarMediaId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/files/${avatarMediaId}?v=thumb`} alt="" className="size-4 shrink-0 rounded-full object-cover" />
  ) : (
    <Bot className="size-4 shrink-0 opacity-70" aria-hidden />
  );

  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center rounded-md text-sm transition-colors",
        collapsed ? "h-9 justify-center" : "gap-2.5 px-2.5 py-1.5",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
      )}
    >
      {collapsed ? (
        <>
          <span className="relative flex">
            {glyph}
            {live && <NavStatusDot label={liveLabel} onIcon />}
          </span>
          <span className="sr-only">{children}</span>
        </>
      ) : (
        <>
          {glyph}
          <span className="truncate">{children}</span>
          {live && <NavStatusDot label={liveLabel} />}
        </>
      )}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {children}
        {live && <span className="opacity-70">· {liveLabel}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function NavSection({ title, collapsed, children }: { title: string; collapsed?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-0.5", collapsed && "mt-2 border-t border-sidebar-border pt-2")}>
      {!collapsed && <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>}
      {children}
    </div>
  );
}

export function SidebarNav({ labels, knowledgeAreas, meetingSpaces, agents, isAdmin, collapsed, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const item = (href: string, icon: IconKey | undefined, label: string, live?: boolean, areaIcon?: string) => (
    <NavItem
      key={href}
      href={href}
      icon={icon}
      areaIcon={areaIcon}
      live={live}
      liveLabel={labels.live}
      active={isActivePath(pathname, href)}
      collapsed={collapsed}
      onNavigate={onNavigate}
    >
      {label}
    </NavItem>
  );

  return (
    <nav className={cn("grid gap-0.5 px-2 pb-6", collapsed && "pt-1")} aria-label="Main">
      {item("/home", "home", labels.home)}

      <NavSection title={labels.knowledge} collapsed={collapsed}>
        {knowledgeAreas.length === 0 && !collapsed && <p className="px-2.5 py-1 text-xs text-muted-foreground">{labels.noAreasYet}</p>}
        {knowledgeAreas.map((a) => item(`/knowledge/${a.slug}`, undefined, a.name, false, a.icon))}
      </NavSection>

      {/* No agents (or the section switched off via AGENTS_IN_NAV) – no empty heading either. */}
      {agents.length > 0 && (
        <NavSection title={labels.agents} collapsed={collapsed}>
          {agents.map((a) => (
            <NavItem
              key={a.slug}
              href={`/agents/${a.slug}`}
              avatarMediaId={a.avatarMediaId}
              liveLabel={labels.live}
              active={isActivePath(pathname, `/agents/${a.slug}`)}
              collapsed={collapsed}
              onNavigate={onNavigate}
            >
              {a.name}
            </NavItem>
          ))}
        </NavSection>
      )}

      <NavSection title={labels.meetings} collapsed={collapsed}>
        {meetingSpaces.length === 0 && !collapsed && <p className="px-2.5 py-1 text-xs text-muted-foreground">{labels.noSpacesYet}</p>}
        {meetingSpaces.map((s) => item(`/meetings/${s.slug}`, undefined, s.name, s.live, s.icon))}
      </NavSection>

      <div className={cn("grid gap-0.5", collapsed ? "mt-2 border-t border-sidebar-border pt-2" : "pt-4")}>
        {item("/members", "members", labels.members)}
        {item("/workflows", "workflows", labels.workflows)}
        {isAdmin && item("/admin", "admin", labels.admin)}
      </div>
    </nav>
  );
}
