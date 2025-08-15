import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

interface Env {
  DB: D1Database
  VEC: VectorizeIndex
  TERMS: KVNamespace
  INBOX: R2Bucket
  Q_INGEST: Queue
  AI: Ai
}

const app = new OpenAPIHono<{ Bindings: Env }>()

app.get('/', c => c.json({ status: 'ok' }))

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

app.get('/ws', () => {
  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]
  server.accept()
  server.addEventListener('message', (e) => {
    server.send(e.data)
  })
  return new Response(null, { status: 101, webSocket: client })
})

app.doc('/openapi.json', {
  info: { title: 'GH Stars MCP API', version: '1.0.0' },
})

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>) {
    for (const msg of batch.messages) {
      console.log('queue message', msg.body)
    }
  },
}
