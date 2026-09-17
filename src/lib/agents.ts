/** Fixed id of the system agent (see src/server/domain/agents.ts). Client-safe constant. */
export const SYSTEM_AGENT_ID = "b0000000-0000-4000-8000-000000000001";
/** Url segment of the system agent: /agents/<slug>. */
export const SYSTEM_AGENT_SLUG = "assistent";
/** Entries the configuration tree loads per collection; beyond that the search is the way in. */
export const TREE_ENTRY_LIMIT = 200;
/** Writes per answer. A single chat sentence must not be able to rewrite a whole collection. */
export const MAX_WRITES_PER_TURN = 10;
/**
 * Whether the sidebar lists the agents. Off while the feature is not used productively – the routes
 * (/agents/…) and the admin page stay reachable, only the menu entry is gone. Flip to `true` to bring it back.
 */
export const AGENTS_IN_NAV = false;
