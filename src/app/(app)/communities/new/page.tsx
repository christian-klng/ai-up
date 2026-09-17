import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { canCreateCommunityAction } from "@/server/actions/communities";
import { PageHeader } from "@/components/common/page-header";
import { CreateCommunityForm } from "./create-form";

/** Starting a sub-community. Reachable from the switcher when the operator allows it. */
export default async function NewCommunityPage() {
  const user = await requireUser();
  if (!(await canCreateCommunityAction())) redirect("/home");
  const t = await getTranslations("communities.create");

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <CreateCommunityForm defaultLocale={user.locale} />
    </div>
  );
}
