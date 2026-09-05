import { describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import type { ParseChat } from '../src/parse'

const body = { text: '明天下午三点去牙医，大概一小时', now: '2026-08-30T16:00:00.000Z', timezone: 'Asia/Shanghai' }

async function request(text: unknown, parseProvider?: ParseChat): Promise<Response> {
  return app.request('http://localhost/v1/ai/parse', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lifeflow-device': 'a3b1c2d4-0000-4000-8000-000000000001' }, body: JSON.stringify(text) }, parseProvider ? { PARSE_PROVIDER: parseProvider } : undefined)
}

describe('LifeFlow AI parse endpoint', () => {
  it('returns sanitized drafts from the provider', async () => {
    const provider: ParseChat = vi.fn(async () => JSON.stringify({
      drafts: [{ title: '去牙医', date: '2026-08-31', pinTime: '15:00', minutes: 60, junk: '幻觉字段' }, { title: '' }],
      reply: '已解析。',
    }))
    const response = await request(body, provider)
    expect(response.status).toBe(200)
    const data = await response.json() as { ok: boolean; drafts: Array<{ title: string; date?: string; pinTime?: string; junk?: string }> }
    expect(data.ok).toBe(true)
    expect(data.drafts).toHaveLength(1)
    expect(data.drafts[0].title).toBe('去牙医')
    expect(data.drafts[0].pinTime).toBe('15:00')
    expect(data.drafts[0].junk).toBeUndefined()
  })

  it('rejects an empty or missing text', async () => {
    const response = await request({ text: '' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
  })

  it('reports unavailability without leaking the provider failure', async () => {
    const provider: ParseChat = vi.fn(async () => { throw new Error('secret upstream') })
    const response = await request(body, provider)
    expect(response.status).toBe(502)
    const text = await response.text()
    expect(text).toContain('PROVIDER_UNAVAILABLE')
    expect(text).not.toContain('secret upstream')
  })

  it('rejects a provider reply with no usable drafts', async () => {
    const provider: ParseChat = vi.fn(async () => JSON.stringify({ drafts: [{ title: '' }], reply: '空' }))
    const response = await request(body, provider)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_PROVIDER_RESPONSE' })
  })
})
