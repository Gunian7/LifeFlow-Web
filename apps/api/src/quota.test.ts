import { describe, expect, it } from 'vitest'
import app from './index'
import { deviceIdFrom, readQuota, recordUsage, type D1Like } from './quota'

// Minimal in-memory D1 fake covering the two statements quota.ts uses.
function fakeD1(): D1Like & { rows: Map<string, number> } {
  const rows = new Map<string, number>()
  return {
    rows,
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          const [deviceId, day] = values as [string, string]
          const key = `${deviceId}|${day}`
          return {
            async first<T>(): Promise<T | null> {
              if (!query.includes('SELECT')) return null
              const count = rows.get(key) ?? 0
              return { count } as T
            },
            async run(): Promise<unknown> {
              if (query.includes('ON CONFLICT')) rows.set(key, (rows.get(key) ?? 0) + 1)
              return null
            },
          }
        },
      }
    },
  }
}

describe('device identity', () => {
  it('accepts well-formed UUIDs and normalizes case', () => {
    expect(deviceIdFrom('A3B1C2D4-0000-4000-8000-000000000001')).toBe('a3b1c2d4-0000-4000-8000-000000000001')
  })

  it('rejects junk headers', () => {
    expect(deviceIdFrom('not-a-uuid')).toBeNull()
    expect(deviceIdFrom(undefined)).toBeNull()
    expect(deviceIdFrom(12345)).toBeNull()
  })
})

describe('daily quota', () => {
  it('starts at zero and counts every recorded call', async () => {
    const db = fakeD1()
    expect((await readQuota(db, 'device-a', '2026-08-31', 20)).used).toBe(0)
    await recordUsage(db, 'device-a', '2026-08-31')
    await recordUsage(db, 'device-a', '2026-08-31')
    const snapshot = await readQuota(db, 'device-a', '2026-08-31', 20)
    expect(snapshot.used).toBe(2)
    expect(snapshot.remaining).toBe(18)
    expect(snapshot.mode).toBe('enforced')
  })

  it('isolates devices and days', async () => {
    const db = fakeD1()
    await recordUsage(db, 'device-a', '2026-08-31')
    await recordUsage(db, 'device-a', '2026-08-31')
    expect((await readQuota(db, 'device-b', '2026-08-31', 20)).used).toBe(0)
    expect((await readQuota(db, 'device-a', '2026-09-01', 20)).used).toBe(0)
  })

  it('fails open when the database binding is not configured', async () => {
    const snapshot = await readQuota(undefined, 'device-a', '2026-08-31', 20)
    expect(snapshot.mode).toBe('unconfigured')
    expect(snapshot.remaining).toBe(20)
    await expect(recordUsage(undefined, 'device-a', '2026-08-31')).resolves.toBeUndefined()
  })
})

const DEVICE = 'a3b1c2d4-0000-4000-8000-000000000001'

describe('quota gate on AI routes', () => {
  it('rejects AI requests without a device header', async () => {
    const response = await app.request('http://localhost/v1/ai/quota')
    expect(response.status).toBe(401)
  })

  it('enforces the daily limit and returns 429 when exhausted', async () => {
    const db = fakeD1()
    const env = { DB: db, FREE_DAILY_LIMIT: '1', PARSE_PROVIDER: async () => JSON.stringify({ drafts: [{ title: '解析出的任务' }], reply: '好的' }) }
    const headers = { 'content-type': 'application/json', 'x-lifeflow-device': DEVICE }
    const first = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers, body: JSON.stringify({ text: '买牛奶', now: '2026-08-31T10:00:00.000Z' }) }, env)
    expect(first.status).toBe(200)
    expect(first.headers.get('X-Quota-Remaining')).toBe('0')
    const second = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers, body: JSON.stringify({ text: '再买一件', now: '2026-08-31T10:00:00.000Z' }) }, env)
    expect(second.status).toBe(429)
    expect(await second.json()).toMatchObject({ ok: false, error: 'QUOTA_EXCEEDED', limit: 1 })
  })

  it('fails open without a DB binding', async () => {
    const env = { PARSE_PROVIDER: async () => JSON.stringify({ drafts: [{ title: '解析出的任务' }], reply: '好的' }) }
    const headers = { 'content-type': 'application/json', 'x-lifeflow-device': DEVICE }
    const response = await app.request('http://localhost/v1/ai/parse', { method: 'POST', headers, body: JSON.stringify({ text: '买牛奶', now: '2026-08-31T10:00:00.000Z' }) }, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Quota-Mode')).toBe('unconfigured')
  })
})
