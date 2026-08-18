import { getTranslations } from "next-intl/server";
import { PageHeader } from "./page-header";

export async function ComingSoon({ title }: { title: string }) {
  const t = await getTranslations("common");
  return (
    <div>
      <PageHeader title={title} />
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{t("comingSoon")}</div>
    </div>
  );
}
