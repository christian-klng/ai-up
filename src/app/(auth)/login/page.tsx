import { redirect } from "next/navigation";
import { getAccount, getCurrentUser } from "@/server/auth/session";
import { getHostCommunity } from "@/server/community-context";
import { getRootCommunity } from "@/server/domain/communities";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect(user.status === "active" ? "/home" : "/pending");
  // Signed in, but no way into this community: /pending says why. A form would only loop back here.
  if (await getAccount()) redirect("/pending");
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  // The way in for people who are not after an account here but want a community of their own.
  const canFound = !(await getHostCommunity()) && (await getRootCommunity()).allowPublicCommunities;
  return <LoginForm next={next} error={error} canFound={canFound} />;
}
