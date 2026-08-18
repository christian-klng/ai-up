import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { unreadNotificationCount } from "@/server/domain/notifications";
import { signOut } from "@/server/actions/auth";
import { AppShell } from "@/components/shell/app-shell";
import { BrandLogo } from "@/components/shell/brand-logo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [settings, tNav, tAuth, tCommon, unreadNotifications] = await Promise.all([
    getAppSettings(),
    getTranslations("nav"),
    getTranslations("auth"),
    getTranslations("common"),
    unreadNotificationCount(user.id),
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
        // Phase 2/4 fill these from the database.
        knowledgeAreas: [],
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
        menu: "Menu",
      }}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
