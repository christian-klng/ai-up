import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { getLiveKitView } from "@/server/domain/integrations";
import { PageHeader } from "@/components/common/page-header";
import { LiveKitForm } from "./livekit-form";

export default async function AdminIntegrationsPage() {
  await requireAdmin();
  const [t, format, lk] = await Promise.all([getTranslations("admin.integrations"), getFormatter(), getLiveKitView()]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <LiveKitForm
        initial={{
          enabled: lk.enabled,
          url: lk.url,
          apiKey: lk.apiKey,
          recordingsPath: lk.recordingsPath,
          recordingDefault: lk.recordingDefault,
          s3Endpoint: lk.s3Endpoint,
          s3Region: lk.s3Region,
          s3Bucket: lk.s3Bucket,
          s3AccessKey: lk.s3AccessKey,
          hasSecret: lk.hasSecret,
          secretMasked: lk.secretMasked,
          hasS3Secret: lk.hasS3Secret,
          s3SecretMasked: lk.s3SecretMasked,
        }}
        lastTest={lk.lastTestAt ? `${format.dateTime(lk.lastTestAt, { dateStyle: "medium", timeStyle: "short" })} – ${lk.lastTestResult ?? ""}` : null}
      />
    </div>
  );
}
