import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Clock, ShieldOff } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Shown to signed-in users whose account is not active (pending approval or suspended). */
export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "active") redirect("/");
  const t = await getTranslations("auth");
  const suspended = user.status === "suspended";

  return (
    <Card>
      <CardHeader>
        {suspended ? <ShieldOff className="size-8 text-destructive" aria-hidden /> : <Clock className="size-8 text-primary" aria-hidden />}
        <CardTitle>{suspended ? t("suspendedTitle") : t("pendingTitle")}</CardTitle>
        <CardDescription>{suspended ? t("suspendedBody") : t("pendingBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signOut}>
          <Button variant="outline" type="submit">
            {t("signOut")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
