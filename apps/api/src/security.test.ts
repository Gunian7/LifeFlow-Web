import { describe, expect, it, vi } from 'vitest'
import app from './index'
import type { ParseChat } from './parse'
import type { BriefingChat } from './briefing'

// Security-focused tests for the AI endpoints: input limits, quota gate,
// secret hygiene. These complement the functional tests in parse/briefing.

const DEVICE = 'a3b1c2d4-0000-4000-8000-000000000001'
const HEADERS = { 'content-type': 'application/json', 'x-lifeflow-device': DEVICE }

const parseProvider: ParseChat = vi.fn(async () => JSON.stringify({ drafts: [{ title: '解析出的任务' }], reply: '好的' }))
const briefingProvider: BriefingChat = vi.fn(async () => '早。今天的事不多。')

function parseEnv() {
  return { PARSE_PROVIDER: parseProvider, BRIEFING_PROVIDER: briefingProvider }
}

describe('AI endpoint input limits', () => {
  it('rejects a malformed JSON body with 400', async () => {
    const response = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers: HEADERS, body: '{not json' }, parseEnv())
    expect(response.status).toBe(400)
  })

  it('rejects non-string text fields', async () => {
    const response = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers: HEADERS, body: JSON.stringify({ text: { evil: true }, now: '2026-08-31T10:00:00.000Z' }) }, parseEnv())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
  })

  it('caps oversized text input to 500 characters before it reaches the model', async () => {
    const seen: Array<string> = []
    const spy: ParseChat = vi.fn(async (prompt: string) => { seen.push(prompt); return JSON.stringify({ drafts: [{ title: '任务' }], reply: '好' }) })
    const huge = '长'.repeat(5000)
    const response = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers: HEADERS, body: JSON.stringify({ text: huge, now: '2026-08-31T10:00:00.000Z' }) }, { PARSE_PROVIDER: spy })
    expect(response.status).toBe(200)
    expect(seen[0].length).toBeLessThan(huge.length)
  })

  it('rejects a breakdown without positive integer minutes', async () => {
    const response = await app.request('http://localhost/v1/ai/breakdown', { method: 'POST', headers: HEADERS, body: JSON.stringify({ title: '大任务', minutes: -5 }) }, parseEnv())
    expect(response.status).toBe(400)
  })

  it('rejects a briefing body that is not an object', async () => {
    const response = await app.request('http://localhost/v1/ai/briefing', { method: 'POST', headers: HEADERS, body: JSON.stringify([1, 2, 3]) }, parseEnv())
    expect(response.status).toBe(400)
  })
})

describe('AI endpoint quota and identity enforcement', () => {
  it('applies the quota gate to breakdown like every other AI route', async () => {
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first<T>(): Promise<T | null> { return { count: 999 } as T },
              async all<T>(): Promise<{ results?: T[] }> { return { results: [] } },
              async run(): Promise<unknown> { return null },
            }
          },
        }
      },
    }
    const response = await app.request('http://localhost/v1/ai/breakdown', { method: 'POST', headers: HEADERS, body: JSON.stringify({ title: '大任务', minutes: 60 }) }, { DB: db, BREAKDOWN_PROVIDER: async () => JSON.stringify({ subtasks: [{ title: 'a', minutes: 30 }, { title: 'b', minutes: 30 }] }) })
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ ok: false, error: 'QUOTA_EXCEEDED' })
  })

  it('returns 401 on every AI route without a device header', async () => {
    const routes: Array<[string, unknown]> = [
      ['/v1/ai/parse', { text: 'x', now: '2026-08-31T10:00:00.000Z' }],
      ['/v1/ai/briefing', { facts: { taskCount: 1 } }],
      ['/v1/ai/breakdown', { title: 'x', minutes: 30 }],
      ['/v1/ai/order', { tasks: [{ id: 'a', title: 'a', durationMinutes: 30, importance: 'want' }] }],
    ]
    for (const [route, body] of routes) {
      const response = await app.request(`http://localhost${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, parseEnv())
      expect(response.status).toBe(401)
    }
  })
})

describe('secret hygiene on auth surface', () => {
  it('never echoes the password hash through registration errors', async () => {
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first<T>(): Promise<T | null> {
                if (query.includes('FROM users WHERE email')) return { id: 'u1', email: values[0], password_hash: 'pbkdf2:100000:salt:secrethash', created_at: '', plan: 'free', plan_expires_at: null } as T
                return null
              },
              async all<T>(): Promise<{ results?: T[] }> { return { results: [] } },
              async run(): Promise<unknown> { return null },
            }
          },
        }
      },
    }
    const response = await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'taken@example.com', password: 'long-enough-password' }) }, { DB: db })
    expect(response.status).toBe(409)
    const body = await response.text()
    expect(body).not.toContain('secrethash')
    expect(body).not.toContain('pbkdf2')
  })

  it('login failure and success responses never include the hash', async () => {
    const response = await app.request('http://localhost/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', password: 'long-enough-password' }) }, { DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => null }) }) } })
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('pbkdf2')
  })
})

describe('hardening headers and body cap', () => {
  it('sets nosniff and no-referrer on AI responses', async () => {
    const response = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers: HEADERS, body: JSON.stringify({ text: '买牛奶', now: '2026-08-31T10:00:00.000Z' }) }, parseEnv())
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('rejects bodies declaring more than 64KB via Content-Length', async () => {
    const response = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers: { ...HEADERS, 'content-length': String(200 * 1024) }, body: 'x' }, parseEnv())
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ ok: false, error: 'PAYLOAD_TOO_LARGE' })
  })

  it('allows the admin-key header through CORS preflight', async () => {
    const response = await app.request('http://localhost/v1/ai/order', { method: 'OPTIONS', headers: { Origin: 'https://gunian7.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-admin-key' } })
    expect(response.status).toBe(204)
    const allowed = response.headers.get('Access-Control-Allow-Headers') ?? ''
    expect(allowed.toLowerCase()).toContain('x-admin-key')
  })
})
