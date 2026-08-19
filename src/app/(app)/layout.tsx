import { requireUser } from "@/server/auth/session";
import { AppShellServer } from "@/components/shell/app-shell-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShellServer user={user}>{children}</AppShellServer>;
}
