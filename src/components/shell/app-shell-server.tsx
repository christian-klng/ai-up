import { getTranslations } from "next-intl/server";
import type { CurrentUser } from "@/server/auth/session";
import { getCommunity, listMembershipsForUser } from "@/server/domain/communities";
import { unreadNotificationCount } from "@/server/domain/notifications";
import { listAreas } from "@/server/domain/knowledge";
import { unreadMessagesCount } from "@/server/domain/messenger";
import { signOut } from "@/server/actions/auth";
import { canCreateCommunityAction } from "@/server/actions/communities";
import { AppShell } from "./app-shell";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { CallProvider } from "@/components/meetings/call-provider";
import { CallMiniPlayer } from "@/components/meetings/call-mini-player";
import { WorkflowToasts } from "@/components/workflows/workflow-toasts";
import { QuestionDock } from "@/components/questions/question-dock";
import { listOpenQuestionsForUser } from "@/server/domain/questions";
import { listSpaces } from "@/server/domain/meetings";
import { listAgentsForUser } from "@/server/domain/agents";
import { AGENTS_IN_NAV } from "@/lib/agents";
import { BrandLogo } from "./brand-logo";

/**
 * Server wrapper: loads everything the shell needs (community, nav data, counters) once per request.
 * Every counter and list is scoped to the community the member is currently acting in.
 */
export async function AppShellServer({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const cid = user.communityId;
  const [community, tNav, tAuth, tCommon, unreadNotifications, unreadMessages, areas, openQuestions, spaces, agents] = await Promise.all([
    getCommunity(cid),
    getTranslations("nav"),
    getTranslations("auth"),
    getTranslations("common"),
    unreadNotificationCount(user.id, cid),
    unreadMessagesCount(cid, user.id),
    listAreas(cid),
    listOpenQuestionsForUser(cid, user.id),
    listSpaces(cid),
    // Hidden from the sidebar for now (AGENTS_IN_NAV) – then there is nothing to load either.
    AGENTS_IN_NAV ? listAgentsForUser(cid, user.id) : Promise.resolve([]),
  ]);
  // Every community this account may act in – the sidebar turns into a switcher from two on.
  const memberships = await listMembershipsForUser(user.id, { status: "active" });
  const canCreateCommunity = await canCreateCommunityAction();
  const settings = community!;

  return (
    <RealtimeProvider userId={user.id} communityId={cid} initialCounts={{ unreadMessages, unreadNotifications }}>
    <CallProvider>
    <AppShell
      brand={{ name: settings.name, logo: <BrandLogo settings={settings} size={28} /> }}
      community={{
        current: { id: settings.id, name: settings.name, tagline: settings.tagline, logoMediaId: settings.logoMediaId, role: user.role },
        all: memberships.map((m) => ({ id: m.communityId, name: m.community.name, tagline: m.community.tagline, logoMediaId: m.community.logoMediaId, role: m.role })),
        canCreate: canCreateCommunity,
      }}
      user={{ id: user.id, name: user.name, email: user.email, avatarMediaId: user.avatarMediaId, role: user.role }}
      nav={{
        labels: {
          home: tNav("home"),
          knowledge: tNav("knowledge"),
          members: tNav("members"),
          meetings: tNav("meetings"),
          workflows: tNav("workflows"),
          agents: tNav("agents"),
          admin: tNav("admin"),
          noAreasYet: tNav("noAreasYet"),
          noSpacesYet: tNav("noSpacesYet"),
        },
        knowledgeAreas: areas.map((a) => ({ id: a.id, name: a.name, slug: a.slug, icon: a.icon })),
        meetingSpaces: spaces.map((s) => ({ id: s.id, name: s.name, slug: s.slug, icon: s.icon, live: s.liveCount > 0 })),
        agents: agents.map((a) => ({ id: a.id, name: a.name, slug: a.slug, avatarMediaId: a.avatarMediaId })),
        isAdmin: user.role === "admin",
      }}
      labels={{
        messages: tNav("messages"),
        notifications: tNav("notifications"),
        profile: tNav("profile"),
        admin: tNav("admin"),
        signOut: tAuth("signOut"),
        menu: tCommon("menu"),
      }}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
    <WorkflowToasts isAdmin={user.role === "admin"} />
    <QuestionDock initial={openQuestions} />
    <CallMiniPlayer />
    </CallProvider>
    </RealtimeProvider>
  );
}
