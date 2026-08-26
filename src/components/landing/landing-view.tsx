import { getTranslations } from "next-intl/server";
import type { AppSettings } from "@/server/db/schema";
import type { LandingDefinition } from "@/lib/landing-schema";
import { LandingShell } from "./landing-shell";

/** Server wrapper for the public landing page: resolves labels, renders the shared shell. */
export async function LandingView({
  definition,
  settings,
  signedIn,
}: {
  definition: LandingDefinition;
  settings: AppSettings;
  signedIn: boolean;
}) {
  const [t, tCommon] = await Promise.all([getTranslations("landing"), getTranslations("common")]);
  return (
    <LandingShell
      definition={definition}
      settings={settings}
      signedIn={signedIn}
      labels={{ toApp: t("toApp"), signIn: t("signIn"), register: t("register"), menu: tCommon("menu") }}
    />
  );
}
