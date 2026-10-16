import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Clock, ShieldOff, UserX } from "lucide-react";
import { getAccessBlock, getAccount, getPublicCommunity } from "@/server/auth/session";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown to signed-in accounts that cannot enter the app here: awaiting approval, suspended, or not a
 * member of the community this host belongs to. Asks the account, not `getCurrentUser()` – that one
 * is null for exactly these visitors, and sending them to /login would only loop back here.
 */
export default async function PendingPage() {
  const account = await getAccount();
  if (!account) redirect("/login");
  const block = await getAccessBlock();
  if (!block) redirect("/home");
  const [t, community] = await Promise.all([getTranslations("auth"), getPublicCommunity()]);

  const Icon = block === "suspended" ? ShieldOff : block === "notMember" ? UserX : Clock;
  return (
    <Card>
      <CardHeader>
        <Icon className={block === "pending" ? "size-8 text-primary" : "size-8 text-destructive"} aria-hidden />
        <CardTitle>{t(`${block}Title`)}</CardTitle>
        <CardDescription>{block === "notMember" ? t("notMemberBody", { community: community.name }) : t(`${block}Body`)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">{t("signedInAs", { email: account.email })}</p>
        <form action={signOut}>
          <Button variant="outline" type="submit">
            {t("signOut")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
