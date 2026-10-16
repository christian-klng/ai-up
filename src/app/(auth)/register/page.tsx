import { redirect } from "next/navigation";
import { getAccount, getCurrentUser } from "@/server/auth/session";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.status === "active" ? "/home" : "/pending");
  // Signed in, but no way into this community: /pending says why. A form would only loop back here.
  if (await getAccount()) redirect("/pending");
  return <RegisterForm />;
}
