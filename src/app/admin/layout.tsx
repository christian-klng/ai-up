import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { unreadNotificationCount } from "@/server/domain/notifications";
import { countUsersByStatus } from "@/server/domain/users";
import { signOut } from "@/server/actions/auth";
import { AppShell } from "@/components/shell/app-shell";
import { BrandLogo } from "@/components/shell/brand-logo";
import { AdminNav } from "./admin-nav";

/** Admin area re-uses the app shell and adds a secondary navigation. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [settings, tNav, tAuth, tCommon, tAdmin, unreadNotifications, counts] = await Promise.all([
    getAppSettings(),
    getTranslations("nav"),
    getTranslations("auth"),
    getTranslations("common"),
    getTranslations("admin"),
    unreadNotificationCount(user.id),
    countUsersByStatus(),
  ]);

  const items = [
    { href: "/admin/general", label: tAdmin("nav.general") },
    { href: "/admin/purpose", label: tAdmin("nav.purpose") },
    { href: "/admin/members", label: tAdmin("nav.members"), badge: counts.pending || undefined },
    { href: "/admin/knowledge", label: tAdmin("nav.knowledge"), disabled: true },
    { href: "/admin/meetings", label: tAdmin("nav.meetings"), disabled: true },
    { href: "/admin/workflows", label: tAdmin("nav.workflows"), disabled: true },
    { href: "/admin/llm", label: tAdmin("nav.llm"), disabled: true },
    { href: "/admin/integrations", label: tAdmin("nav.integrations"), disabled: true },
    { href: "/admin/api-keys", label: tAdmin("nav.apiKeys"), disabled: true },
    { href: "/admin/audit", label: tAdmin("nav.audit"), disabled: true },
  ];

  return (
    <AppShell
      brand={{ name: settings.name, logo: <BrandLogo settings={settings} size={28} /> }}
      user={{ id: user.id, name: user.name, email: user.email, avatarMediaId: user.avatarMediaId, role: user.role }}
      nav={{
        labels: {
          home: tNav("home"),
          knowledge: tNav("knowledge"),
          members: tNav("members"),
          meetings: tNav("meetings"),
          workflows: tNav("workflows"),
          admin: tNav("admin"),
          noAreasYet: tNav("noAreasYet"),
          noSpacesYet: tNav("noSpacesYet"),
        },
        knowledgeAreas: [],
        meetingSpaces: [],
        isAdmin: true,
      }}
      counts={{ unreadMessages: 0, unreadNotifications }}
      labels={{
        messages: tNav("messages"),
        notifications: tNav("notifications"),
        profile: tNav("profile"),
        admin: tNav("admin"),
        signOut: tAuth("signOut"),
        language: tCommon("language"),
        menu: "Menu",
      }}
      signOutAction={signOut}
    >
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <aside className="min-w-0">
          <h2 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{tAdmin("title")}</h2>
          <AdminNav items={items} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </AppShell>
  );
}
