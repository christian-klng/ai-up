import { getFormatter, getTranslations } from "next-intl/server";
import { requireRootAdmin } from "@/server/auth/session";
import { getEventsView, getLiveKitView } from "@/server/domain/integrations";
import { PageHeader } from "@/components/common/page-header";
import { EventsForm } from "./events-form";
import { LiveKitForm } from "./livekit-form";

export default async function AdminIntegrationsPage() {
  // LiveKit credentials and the recording storage belong to whoever runs the installation.
  await requireRootAdmin();
  const [t, format, lk, ev] = await Promise.all([getTranslations("admin.integrations"), getFormatter(), getLiveKitView(), getEventsView()]);
  const stamp = (at: Date | null, result: string | null) => (at ? `${format.dateTime(at, { dateStyle: "medium", timeStyle: "short" })} – ${result ?? ""}` : null);
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <div className="grid gap-6">
        <LiveKitForm
          initial={{
            enabled: lk.enabled,
            url: lk.url,
            apiKey: lk.apiKey,
            recordingsPath: lk.recordingsPath,
            s3Endpoint: lk.s3Endpoint,
            s3Region: lk.s3Region,
            s3Bucket: lk.s3Bucket,
            s3AccessKey: lk.s3AccessKey,
            hasSecret: lk.hasSecret,
            secretMasked: lk.secretMasked,
            hasS3Secret: lk.hasS3Secret,
            s3SecretMasked: lk.s3SecretMasked,
          }}
          lastTest={stamp(lk.lastTestAt, lk.lastTestResult)}
        />
        <EventsForm initial={{ enabled: ev.enabled, url: ev.url }} lastTest={stamp(ev.lastTestAt, ev.lastTestResult)} />
      </div>
    </div>
  );
}
