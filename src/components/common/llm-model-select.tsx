"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type LlmProviderOption = {
  id: string;
  name: string;
  isDefault: boolean;
  defaultModel: string | null;
  /** `supportsTools` undefined = the provider reports no capabilities (generic endpoints). */
  models: { id: string; name?: string; supportsTools?: boolean }[];
};

/** Provider + model pair used by the workflow editor, the template evaluation and the agents. */
export function LlmModelSelect({
  providers,
  providerId,
  model,
  onChange,
  disabled,
  id,
  requireTools,
}: {
  providers: LlmProviderOption[];
  /** provider id or "default" */
  providerId: string;
  /** model id or "default" */
  model: string;
  onChange: (next: { providerId: string; model: string }) => void;
  disabled?: boolean;
  id?: string;
  /** Agents: hide models known to lack tool calling and warn about the ones we cannot tell. */
  requireTools?: boolean;
}) {
  const t = useTranslations("common.llm");
  const provider = providers.find((p) => p.id === providerId) ?? providers.find((p) => p.isDefault) ?? providers[0];
  const models = requireTools ? (provider?.models ?? []).filter((m) => m.supportsTools !== false) : provider?.models ?? [];
  // Only warn about a concrete pick – "default" resolves server-side and may be anything.
  const unknownTools = requireTools && model !== "default" && models.find((m) => m.id === model)?.supportsTools === undefined;
  if (providers.length === 0) return <p className="text-sm text-destructive">{t("noProviders")}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={providerId} onValueChange={(val) => onChange({ providerId: val, model: "default" })} disabled={disabled}>
        <SelectTrigger id={id} className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t("defaultProvider")}</SelectItem>
          {providers.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={model} onValueChange={(val) => onChange({ providerId, model: val })} disabled={disabled}>
        <SelectTrigger className="w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t("defaultModel", { model: provider?.defaultModel ?? "–" })}</SelectItem>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name ? `${m.name} (${m.id})` : m.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {requireTools && models.length === 0 && <p className="w-full text-sm text-destructive">{t("noToolModels")}</p>}
      {unknownTools && <p className="w-full text-xs text-muted-foreground">{t("toolSupportUnknown")}</p>}
    </div>
  );
}
