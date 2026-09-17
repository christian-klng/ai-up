import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { requireCommunity } from "@/server/auth/session";
import { PageHeader } from "@/components/common/page-header";
import { PurposeForm } from "./purpose-form";

export default async function AdminPurposePage() {
  await requireAdmin();
  const [t, settings] = await Promise.all([getTranslations("admin.purpose"), requireCommunity()]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <PurposeForm purpose={settings.purpose ?? ""} />
    </div>
  );
}
