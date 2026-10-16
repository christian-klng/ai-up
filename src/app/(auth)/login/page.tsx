import { redirect } from "next/navigation";
import { getAccount, getCurrentUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect(user.status === "active" ? "/home" : "/pending");
  // Signed in, but no way into this community: /pending says why. A form would only loop back here.
  if (await getAccount()) redirect("/pending");
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  return <LoginForm next={next} error={error} />;
}
