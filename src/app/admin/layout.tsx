import { getTranslations } from "next-intl/server";
import { canManagePublicPages, isRootCommunityId, requireAdmin } from "@/server/auth/session";
import { countMembersByStatus } from "@/server/domain/users";
import { AppShellServer } from "@/components/shell/app-shell-server";
import { AdminNav } from "./admin-nav";

/** Admin area re-uses the app shell and adds a secondary navigation. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [tAdmin, counts] = await Promise.all([getTranslations("admin"), countMembersByStatus(user.communityId)]);

  // Two areas belong to whoever runs the installation, not to a community:
  //  - Integrationen: the LiveKit credentials and recording storage every community shares.
  //  - Webseiten: the public pages of a host. A sub-community gets them once it has a host of its
  //    own – a sub-domain or a verified domain – which is what `canManagePublicPages` asks.
  const isRoot = isRootCommunityId(user.communityId);
  const hasPublicPages = await canManagePublicPages(user.communityId);

  const items = [
    { href: "/admin/general", label: tAdmin("nav.general") },
    { href: "/admin/purpose", label: tAdmin("nav.purpose") },
    ...(hasPublicPages ? [{ href: "/admin/pages", label: tAdmin("nav.pages") }] : []),
    ...(isRoot ? [{ href: "/admin/communities", label: tAdmin("nav.communities") }] : []),
    { href: "/admin/members", label: tAdmin("nav.members"), badge: counts.pending || undefined },
    { href: "/admin/knowledge", label: tAdmin("nav.knowledge") },
    { href: "/admin/templates", label: tAdmin("nav.templates") },
    { href: "/admin/meetings", label: tAdmin("nav.meetings") },
    { href: "/admin/workflows", label: tAdmin("nav.workflows") },
    { href: "/admin/agents", label: tAdmin("nav.agents") },
    { href: "/admin/questions", label: tAdmin("nav.questions") },
    { href: "/admin/llm", label: tAdmin("nav.llm") },
    ...(isRoot ? [{ href: "/admin/integrations", label: tAdmin("nav.integrations") }] : []),
    { href: "/admin/api-keys", label: tAdmin("nav.apiKeys") },
    { href: "/admin/audit", label: tAdmin("nav.audit"), disabled: true },
  ];

  return (
    <AppShellServer user={user}>
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <aside className="min-w-0">
          <h2 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{tAdmin("title")}</h2>
          <AdminNav items={items} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </AppShellServer>
  );
}
