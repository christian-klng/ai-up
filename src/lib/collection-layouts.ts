/**
 * Member-facing display settings for collection entry views (layout + sort).
 * Shared by the DB schema, the admin action, the member page and the MCP
 * tools. Framework-neutral (no React/Next imports); the DB schema
 * type-imports CollectionLayout/CollectionSort.
 */
export const COLLECTION_LAYOUTS = ["grid", "compact", "list", "blog"] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

export function isCollectionLayout(value: unknown): value is CollectionLayout {
  return typeof value === "string" && (COLLECTION_LAYOUTS as readonly string[]).includes(value);
}

/** Entry order in the member view; pinned entries always come first. */
export const COLLECTION_SORTS = ["updated", "newest", "oldest", "title"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export function isCollectionSort(value: unknown): value is CollectionSort {
  return typeof value === "string" && (COLLECTION_SORTS as readonly string[]).includes(value);
}
