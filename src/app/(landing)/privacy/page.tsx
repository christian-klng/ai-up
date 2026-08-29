import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { getCurrentLandingVersion } from "@/server/domain/landing";
import { LandingView } from "@/components/landing/landing-view";

/** Public privacy policy page; 404 while disabled or without content. */

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  if (!settings.privacyEnabled) return {};
  const page = await getCurrentLandingVersion("privacy");
  return {
    title: { absolute: page?.definition.meta.title ?? settings.name },
    description: page?.definition.meta.description ?? undefined,
  };
}

export default async function PrivacyPage() {
  const [settings, user] = await Promise.all([getAppSettings(), getCurrentUser()]);
  const page = settings.privacyEnabled ? await getCurrentLandingVersion("privacy") : undefined;
  if (!page) notFound();
  return <LandingView definition={page.definition} settings={settings} signedIn={Boolean(user)} />;
}
