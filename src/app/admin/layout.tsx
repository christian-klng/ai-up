import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { countUsersByStatus } from "@/server/domain/users";
import { AppShellServer } from "@/components/shell/app-shell-server";
import { AdminNav } from "./admin-nav";

/** Admin area re-uses the app shell and adds a secondary navigation. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [tAdmin, counts] = await Promise.all([getTranslations("admin"), countUsersByStatus()]);

  const items = [
    { href: "/admin/general", label: tAdmin("nav.general") },
    { href: "/admin/purpose", label: tAdmin("nav.purpose") },
    { href: "/admin/landing", label: tAdmin("nav.landing") },
    { href: "/admin/members", label: tAdmin("nav.members"), badge: counts.pending || undefined },
    { href: "/admin/knowledge", label: tAdmin("nav.knowledge") },
    { href: "/admin/meetings", label: tAdmin("nav.meetings") },
    { href: "/admin/workflows", label: tAdmin("nav.workflows") },
    { href: "/admin/questions", label: tAdmin("nav.questions") },
    { href: "/admin/llm", label: tAdmin("nav.llm") },
    { href: "/admin/integrations", label: tAdmin("nav.integrations") },
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
