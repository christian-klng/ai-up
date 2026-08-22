import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { listSpaces } from "@/server/domain/meetings";
import { PageHeader } from "@/components/common/page-header";
import { SpaceDialog } from "./space-dialog";
import { SpaceList } from "./space-list";

export default async function AdminMeetingSpacesPage() {
  await requireAdmin();
  const [t, spaces] = await Promise.all([getTranslations("admin.meetings"), listSpaces()]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("intro")} actions={<SpaceDialog mode="create" />} />
      <SpaceList spaces={spaces.map((s) => ({ id: s.id, name: s.name, slug: s.slug, purpose: s.purpose, description: s.description, icon: s.icon, recordingDefault: s.recordingDefault, meetingCount: s.meetingCount, liveCount: s.liveCount }))} />
    </div>
  );
}
