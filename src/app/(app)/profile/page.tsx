import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/common/page-header";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const user = await requireUser();
  const t = await getTranslations("profile");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("title")} />
      <ProfileForm user={{ id: user.id, name: user.name, email: user.email, bio: user.bio, locale: user.locale, avatarMediaId: user.avatarMediaId }} />
    </div>
  );
}
