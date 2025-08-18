import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { fetch } from './utils'

describe('mcp worker', () => {
  it('returns search results', async () => {
    const res = await fetch('/search?q=test')
    expect(res.status).toBe(200)
    const data = await res.json<{ results: string[] }>()
    expect(data.results[0]).toContain('test')
  })

  it('caches search results in KV', async () => {
    const query = 'cache'
    await fetch(`/search?q=${query}`)
    const cached = await env.TERMS.get(query)
    expect(cached).toBeTruthy()
  })
})
