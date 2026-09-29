import { getTranslations } from "next-intl/server";
import type { Community } from "@/server/db/schema";
import { usesEventSections, type LandingDefinition } from "@/lib/landing-schema";
import { getEventsWidgetUrl } from "@/server/domain/integrations";
import { LandingShell } from "./landing-shell";

/** Server wrapper for the public landing page: resolves labels, renders the shared shell. */
export async function LandingView({
  definition,
  settings,
  signedIn,
}: {
  definition: LandingDefinition;
  settings: Community;
  signedIn: boolean;
}) {
  const [t, tCommon, eventsUrl] = await Promise.all([
    getTranslations("landing"),
    getTranslations("common"),
    usesEventSections(definition) ? getEventsWidgetUrl(settings.id) : null,
  ]);
  return (
    <LandingShell
      definition={definition}
      settings={settings}
      signedIn={signedIn}
      eventsUrl={eventsUrl}
      labels={{
        toApp: t("toApp"),
        signIn: t("signIn"),
        register: t("register"),
        menu: tCommon("menu"),
        eventsUnavailable: t("eventsUnavailable"),
        orderStatusHint: t("orderStatusHint"),
      }}
    />
  );
}
