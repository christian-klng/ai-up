import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateApiKey } from "@/server/domain/api-keys";
import { buildMcpServer } from "@/server/mcp/server";
import { getRedis } from "@/server/redis";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RATE_LIMIT_PER_MIN = 120;

/**
 * MCP endpoint (Streamable HTTP, stateless): each request authenticates with an API key —
 * either `Authorization: Bearer aiup_…` or `x-api-key: aiup_…` (claude.ai custom connectors
 * reserve the Authorization header for OAuth, so their request-header auth uses x-api-key).
 * Each request is served by a fresh McpServer instance.
 */
async function handle(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = (req.headers.get("x-api-key") ?? authHeader.replace(/^Bearer\s+/i, "")).trim();
  const auth = await authenticateApiKey(token);
  if (!auth) {
    return new Response(JSON.stringify({ error: "unauthorized", message: "Provide a valid API key: Authorization: Bearer aiup_… or x-api-key: aiup_…" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="ai-up-mcp"' },
    });
  }
  // Simple per-key rate limit
  try {
    const redis = getRedis();
    const bucket = `aiup:mcp:rl:${auth.key.id}:${Math.floor(Date.now() / 60_000)}`;
    const n = await redis.incr(bucket);
    if (n === 1) await redis.expire(bucket, 70);
    if (n > RATE_LIMIT_PER_MIN) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } });
  } catch (err) {
    logger.warn({ err }, "mcp rate limit check failed");
  }

  const server = await buildMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // stateless: tear down after the response has been produced
    void transport.close().catch(() => {});
  }
}

export async function POST(req: Request) {
  return handle(req);
}
export async function GET(req: Request) {
  return handle(req);
}
export async function DELETE(req: Request) {
  return handle(req);
}
