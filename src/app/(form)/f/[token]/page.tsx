import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FileQuestion } from "lucide-react";
import { resolveForm, sectionFormOf } from "@/server/domain/collection-forms";
import { BrandLogo } from "@/components/shell/brand-logo";
import { Markdown } from "@/components/content/markdown";
import { PublicForm } from "@/components/forms/public-form";
import { EmbedBridge } from "@/components/forms/embed-bridge";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/f/[token]">): Promise<Metadata> {
  const { token } = await params;
  const resolved = await resolveForm(token);
  if (!resolved) return {};
  return { title: resolved.form.texts.title || resolved.area.name };
}

/**
 * Public form of a collection (docs/externe-formulare.md): people outside the community send in an
 * entry. Deliberately outside the `(public)` frame – whoever fills this in is a customer of the
 * community, not somebody about to sign in, so there is no app header and no login button.
 * `?embed=1` drops the page chrome for the iframe of the embed script.
 */
export default async function CollectionFormPage({ params, searchParams }: PageProps<"/f/[token]">) {
  const [{ token }, query, t] = await Promise.all([params, searchParams, getTranslations("forms")]);
  const embed = query.embed === "1";
  const resolved = await resolveForm(token);

  if (!resolved) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <FileQuestion className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">{t("closedTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("closedBody")}</p>
      </main>
    );
  }

  const { community } = resolved;
  const form = await sectionFormOf(resolved);

  return (
    <main className={embed ? "w-full p-4" : "mx-auto min-h-svh w-full max-w-xl px-4 py-8 sm:py-12"}>
      {embed && <EmbedBridge />}
      {!embed && (
        <div className="mb-6 flex items-center gap-2.5">
          <BrandLogo settings={community} size={28} />
          <span className="truncate font-semibold tracking-tight">{community.name}</span>
        </div>
      )}
      <div className={embed ? "" : "rounded-xl border bg-card p-5 shadow-sm sm:p-7"}>
        <h1 className="text-xl font-semibold tracking-tight">{form.heading}</h1>
        {form.intro && <Markdown className="mt-2 text-sm text-muted-foreground">{form.intro}</Markdown>}
        <div className="mt-6">
          <PublicForm form={form} />
        </div>
      </div>
    </main>
  );
}
