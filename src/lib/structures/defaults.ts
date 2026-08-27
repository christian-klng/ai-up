import type { StructureDefinition } from "./types";

// System content templates ("Standard-Vorlagen"): seeded with fixed ids,
// not editable or deletable — the seed is authoritative and bumps the version
// when a definition here changes, so entries pick updates up via the normal
// template-upgrade flow. Element keys are load-bearing: the workflow
// `create_content` action and the MCP `create_entry` shortcut fill them.

export type SystemTemplateKey = "text" | "image" | "link" | "video";

type Localized = { de: string; en: string };

export type SystemTemplateDef = {
  id: string;
  systemKey: SystemTemplateKey;
  /** lucide icon key, same set as collection icons */
  icon: string;
  name: Localized;
  description: Localized;
  definition: (locale: "de" | "en") => StructureDefinition;
};

export const SYSTEM_TEMPLATE_IDS: Record<SystemTemplateKey, string> = {
  text: "a0000000-0000-4000-8000-000000000001",
  image: "a0000000-0000-4000-8000-000000000002",
  link: "a0000000-0000-4000-8000-000000000003",
  video: "a0000000-0000-4000-8000-000000000004",
};

function pick(locale: "de" | "en", l: Localized): string {
  return l[locale];
}

const NOTE: Localized = { de: "Notiz", en: "Note" };

export const SYSTEM_TEMPLATES: SystemTemplateDef[] = [
  {
    id: SYSTEM_TEMPLATE_IDS.text,
    systemKey: "text",
    icon: "file-text",
    name: { de: "Einfacher Text", en: "Simple text" },
    description: { de: "Markdown-Text, z. B. Anleitung, Notiz, Artikel.", en: "Markdown text, e.g. a guide, note or article." },
    definition: (locale) => ({
      formatVersion: 1,
      elements: [{ key: "body", type: "markdown", label: pick(locale, { de: "Text", en: "Text" }), required: true }],
    }),
  },
  {
    id: SYSTEM_TEMPLATE_IDS.image,
    systemKey: "image",
    icon: "image",
    name: { de: "Einfaches Bild", en: "Simple image" },
    description: { de: "Bild oder Screenshot – hochladen oder per URL.", en: "Image or screenshot — upload or via URL." },
    definition: (locale) => ({
      formatVersion: 1,
      elements: [
        { key: "image", type: "image", label: pick(locale, { de: "Bild", en: "Image" }), required: true },
        { key: "note", type: "markdown", label: pick(locale, NOTE) },
      ],
    }),
  },
  {
    id: SYSTEM_TEMPLATE_IDS.link,
    systemKey: "link",
    icon: "link-2",
    name: { de: "Link zu einer Webseite", en: "Link to a website" },
    description: { de: "Externer Link mit Vorschau und optionaler Notiz.", en: "External link with preview and optional note." },
    definition: (locale) => ({
      formatVersion: 1,
      elements: [
        { key: "url", type: "link", label: pick(locale, { de: "Link", en: "Link" }), required: true },
        { key: "note", type: "markdown", label: pick(locale, NOTE) },
      ],
    }),
  },
  {
    id: SYSTEM_TEMPLATE_IDS.video,
    systemKey: "video",
    icon: "video",
    name: { de: "Einfaches Video", en: "Simple video" },
    description: { de: "Video hochladen oder verlinken (YouTube, Vimeo, direkte URL).", en: "Upload or link a video (YouTube, Vimeo, direct URL)." },
    definition: (locale) => ({
      formatVersion: 1,
      elements: [
        { key: "video", type: "video", label: pick(locale, { de: "Video", en: "Video" }), required: true },
        { key: "note", type: "markdown", label: pick(locale, NOTE) },
      ],
    }),
  },
];

export function isSystemTemplateKey(value: string): value is SystemTemplateKey {
  return value in SYSTEM_TEMPLATE_IDS;
}
