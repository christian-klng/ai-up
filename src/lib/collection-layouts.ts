/**
 * Member-facing layouts for collection entry views. Shared by the DB schema,
 * the admin action, the member page and the MCP tools. Framework-neutral
 * (no React/Next imports); the DB schema type-imports CollectionLayout.
 */
export const COLLECTION_LAYOUTS = ["grid", "compact", "list", "blog"] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

export function isCollectionLayout(value: unknown): value is CollectionLayout {
  return typeof value === "string" && (COLLECTION_LAYOUTS as readonly string[]).includes(value);
}
