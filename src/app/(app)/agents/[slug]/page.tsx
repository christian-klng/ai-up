import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";

export default async function AgentStartPage() {
  await requireUser();
  const t = await getTranslations("agents");
  return (
    <div className="max-w-sm p-8 text-center text-sm text-muted-foreground">
      <p>{t("selectThread")}</p>
      <p className="mt-1">{t("selectThreadHint")}</p>
    </div>
  );
}
