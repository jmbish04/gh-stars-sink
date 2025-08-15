/**
 * GH Stars Sink — Cloudflare Worker API (Nuxt/Nitro + Hono)
 * =============================================================================
 * PURPOSE
 *   A small but production-minded API surface for the GH Stars Sink app that:
 *     1) Exposes HTTP endpoints (REST + WebSocket) on Cloudflare Workers.
 *     2) Publishes a **static OpenAPI 3.1.0** spec at `/openapi.json` for
 *        ChatGPT Custom Actions / “Custom GPTs”.
 *     3) Publishes a **zod-generated dev spec** at `/mcp/openapi.json` for
 *        internal tooling and quick inspection of `app.openapi()` routes.
 *
 * WHY TWO OPENAPI DOCS?
 *   - /openapi.json (STATIC, 3.1.0): Hand-authored or generated as part of your
 *     build; guaranteed to meet GPT Actions requirements (strict 3.1).
 *   - /mcp/openapi.json (DYNAMIC, usually 3.0.x): Emitted by @hono/zod-openapi
 *     from routes registered via `app.openapi(...)`. Great for dev visibility,
 *     not guaranteed to be 3.1-compliant. We keep it off the canonical path.
 *
 * PUBLIC SURFACE (default, stable):
 *   - GET  /                 → { status: 'ok' } (health)
 *   - GET  /search?q=term    → { results: string[] } (stub)
 *   - GET  /ws               → WebSocket echo (demo transport path)
 *   - GET  /openapi.json     → Static OpenAPI 3.1 schema for GPT Actions
 *
 * DEV SURFACE (non-canonical, can change freely):
 *   - GET  /mcp/openapi.json → zod-generated doc for `app.openapi` routes
 *
 * ENVIRONMENT BINDINGS (Cloudflare):
 *   - DB:     D1Database       — relational storage
 *   - VEC:    VectorizeIndex   — embeddings/vector search
 *   - TERMS:  KVNamespace      — KV for discovery terms / config
 *   - INBOX:  R2Bucket         — object storage (ingest payloads/artifacts)
 *   - Q_INGEST: Queue          — async ingestion fan-in
 *   - AI:     Ai               — Workers AI (LLMs/embeddings)
 *
 * SECURITY MODEL (baseline):
 *   - This file does not enforce auth; protect real endpoints with your
 *     `ensureAuth` (or equivalent) and prefer header-based keys (e.g. x-site-token).
 *   - For GPT Actions, ensure CORS is permissive on `/openapi.json` **only**.
 *   - Rate limit and audit “expensive” routes (D1/Vectorize/AI) via DO/AE logs.
 *
 * CORS:
 *   - `/openapi.json` sets `access-control-allow-origin: *` to be fetchable by
 *     GPT Actions config UIs. Apply stricter CORS on data routes as needed.
 *
 * VERSIONING & CHANGE MANAGEMENT:
 *   - Bump `info.version` in the static 3.1 spec whenever a breaking API change
 *     is shipped. Keep `/mcp/openapi.json` as a dev preview of in-flight changes.
 *
 * BUILD/DEPLOY NOTES:
 *   - You’re on Nitro preset `cloudflare-module`; build emits to `dist/`.
 *   - Wrangler serves assets from `dist` (which includes `dist/public/openapi.json`).
 *   - If assets ever aren’t wired, we still serve the static spec with code here.
 *
 * TESTABILITY & OBSERVABILITY:
 *   - Add vitest coverage for route handlers; for queues, exercise `queue()`.
 *   - Centralize logging (json lines) and include requestId/tenantId for traceability.
 *
 * EXTENSION POINTS (suggested next steps):
 *   - Replace `/search` stub with hybrid query: KV terms → D1 filter → Vectorize.
 *   - Add CRUD for links/repos, ingestion routes, metrics, and activity feed.
 *   - Optional `/docs` route: self-hosted Swagger UI loading `/openapi.json`.
 *   - Add structured errors (problem+json) and pagination (page/limit/nextCursor).
 *
 * GPT ACTIONS QUICK CHECKLIST:
 *   [x] OpenAPI 3.1 served at a stable URL (/openapi.json)
 *   [x] CORS open on the schema route
 *   [x] Descriptions + request/response schemas in the static file
 *   [ ] Auth header documented (add in static spec if required)
 *
 * LICENSE & OWNERSHIP:
 *   - Keep the static spec within repo scope (e.g., /public/openapi.json).
 *   - Consider embedding commit SHA and build timestamp in /openapi.json if needed.
 * =============================================================================
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
// Static, GPT-compatible OpenAPI 3.1.0 schema authored in /public
import staticSpec from '../public/openapi.json' assert { type: 'json' }

/**
 * Cloudflare Worker bindings, provided at deploy time via wrangler.toml.
 * Extend here as you add resources (Queues, DOs, KV, R2, D1, Vectorize).
 */
interface Env {
  DB: D1Database
  VEC: VectorizeIndex
  TERMS: KVNamespace
  INBOX: R2Bucket
  Q_INGEST: Queue
  AI: Ai
}

// Hono app with typed environment bindings
const app = new OpenAPIHono<{ Bindings: Env }>()

/**
 * GET /
 * Health probe and quick liveness check.
 * @returns { status: 'ok' }
 */
app.get('/', (c) => c.json({ status: 'ok' }))

/**
 * Example: typed route using zod/openapi
 * Replace this stub with a real hybrid search (KV → D1 → Vectorize).
 *
 * Query:
 *   - q: string (min: 1)
 *
 * Response:
 *   - 200: { results: string[] }
 */
const searchRoute = createRoute({
  method: 'get',
  path: '/search',
  request: {
    query: z.object({
      q: z.string().min(1).openapi({ example: 'hono' }),
    }),
  },
  responses: {
    200: {
      description: 'Search results',
      content: {
        'application/json': {
          schema: z.object({
            results: z.array(z.string()),
          }),
        },
      },
    },
  },
})

app.openapi(searchRoute, (c) => {
  const { q } = c.req.valid('query')
  return c.json({ results: [`stub result for ${q}`] })
})

/**
 * GET /ws
 * Minimal WebSocket echo server.
 * Replace with a progress/event stream (e.g., ingestion updates).
 *
 * Protocol:
 *   - Client sends any text message → server echoes it back 1:1.
 * Status Codes:
 *   - 101 Switching Protocols (successful websocket upgrade)
 */
app.get('/ws', () => {
  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]
  server.accept()
  server.addEventListener('message', (e) => {
    server.send(e.data)
  })
  return new Response(null, { status: 101, webSocket: client })
})

/**
 * DEV DOCS (non-canonical):
 * Auto-generated OpenAPI from zod-registered routes.
 * Useful during development; not guaranteed to be 3.1-compliant.
 * Keep this off `/openapi.json` to avoid confusing external clients.
 */
app.doc('/mcp/openapi.json', {
  info: { title: 'GH Stars MCP API', version: '1.0.0' },
})

/**
 * CANONICAL DOCS (GPT Actions):
 * Serve the static OpenAPI 3.1.0 spec for external agents.
 * CORS is permissive by design on this route (schema fetch only).
 */
app.get('/openapi.json', (c) => {
  c.header('access-control-allow-origin', '*')
  return c.json(staticSpec)
})

/**
 * Cloudflare Queue consumer
 * Processes batched ingestion messages. Replace console logging with
 * idempotent handlers (dedupe keys), retries, and DLQ routing.
 */
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>) {
    for (const msg of batch.messages) {
      // TODO: ingest handler (e.g., write to R2, index in Vectorize, upsert to D1)
      console.log('queue message', msg.body)
    }
  },
}
