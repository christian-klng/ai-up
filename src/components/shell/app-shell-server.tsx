import { getTranslations } from "next-intl/server";
import type { CurrentUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { unreadNotificationCount } from "@/server/domain/notifications";
import { listAreas } from "@/server/domain/knowledge";
import { unreadMessagesCount } from "@/server/domain/messenger";
import { signOut } from "@/server/actions/auth";
import { AppShell } from "./app-shell";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { WorkflowToasts } from "@/components/workflows/workflow-toasts";
import { QuestionDock } from "@/components/questions/question-dock";
import { listOpenQuestionsForUser } from "@/server/domain/questions";
import { BrandLogo } from "./brand-logo";

/** Server wrapper: loads everything the shell needs (settings, nav data, counters) once per request. */
export async function AppShellServer({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const [settings, tNav, tAuth, tCommon, unreadNotifications, unreadMessages, areas, openQuestions] = await Promise.all([
    getAppSettings(),
    getTranslations("nav"),
    getTranslations("auth"),
    getTranslations("common"),
    unreadNotificationCount(user.id),
    unreadMessagesCount(user.id),
    listAreas(),
    listOpenQuestionsForUser(user.id),
  ]);

  return (
    <RealtimeProvider userId={user.id} initialCounts={{ unreadMessages, unreadNotifications }}>
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
    <WorkflowToasts isAdmin={user.role === "admin"} />
    <QuestionDock initial={openQuestions} />
    </RealtimeProvider>
  );
}
