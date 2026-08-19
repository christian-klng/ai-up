import { getTranslations } from "next-intl/server";
import type { CurrentUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { unreadNotificationCount } from "@/server/domain/notifications";
import { listAreas } from "@/server/domain/knowledge";
import { signOut } from "@/server/actions/auth";
import { AppShell } from "./app-shell";
import { BrandLogo } from "./brand-logo";

/** Server wrapper: loads everything the shell needs (settings, nav data, counters) once per request. */
export async function AppShellServer({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const [settings, tNav, tAuth, tCommon, unreadNotifications, areas] = await Promise.all([
    getAppSettings(),
    getTranslations("nav"),
    getTranslations("auth"),
    getTranslations("common"),
    unreadNotificationCount(user.id),
    listAreas(),
  ]);

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
        knowledgeAreas: areas.map((a) => ({ id: a.id, name: a.name, slug: a.slug, icon: a.icon })),
        // Phase 4 fills meeting spaces from the database.
        meetingSpaces: [],
        isAdmin: user.role === "admin",
      }}
      counts={{ unreadMessages: 0, unreadNotifications }}
      labels={{
        messages: tNav("messages"),
        notifications: tNav("notifications"),
        profile: tNav("profile"),
        admin: tNav("admin"),
        signOut: tAuth("signOut"),
        language: tCommon("language"),
        menu: tCommon("menu"),
      }}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
