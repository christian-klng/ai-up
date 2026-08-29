import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { getCurrentLandingVersion } from "@/server/domain/landing";
import { LandingView } from "@/components/landing/landing-view";

/** Public imprint page; 404 while disabled or without content. */

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  if (!settings.imprintEnabled) return {};
  const page = await getCurrentLandingVersion("imprint");
  return {
    title: { absolute: page?.definition.meta.title ?? settings.name },
    description: page?.definition.meta.description ?? undefined,
  };
}

export default async function ImprintPage() {
  const [settings, user] = await Promise.all([getAppSettings(), getCurrentUser()]);
  const page = settings.imprintEnabled ? await getCurrentLandingVersion("imprint") : undefined;
  if (!page) notFound();
  return <LandingView definition={page.definition} settings={settings} signedIn={Boolean(user)} />;
}
