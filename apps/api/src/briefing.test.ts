import { describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import type { BriefingChat } from '../src/briefing'

const facts = { date: '2026-08-31', taskCount: 3, mustCount: 1, firstTask: { title: '写周报', startLocal: '09:00' }, unscheduledCount: 1, deferredCount: 0, carriedCount: 0, bufferMinutes: 45, windowStart: '08:00', windowEnd: '23:30' }

async function request(body: unknown, provider?: BriefingChat): Promise<Response> {
  return app.request('http://localhost/v1/ai/briefing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, provider ? { BRIEFING_PROVIDER: provider } : undefined)
}

describe('LifeFlow AI briefing endpoint', () => {
  it('returns the model text for valid facts', async () => {
    const provider: BriefingChat = vi.fn(async () => '早。今天三件事，其中写周报是必须的。慢慢来。')
    const response = await request({ facts }, provider)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, text: '早。今天三件事，其中写周报是必须的。慢慢来。' })
  })

  it('rejects a body without facts', async () => {
    const response = await request({ note: 'no facts here' }, vi.fn(async () => 'x'))
    expect(response.status).toBe(400)
  })

  it('ignores an empty model reply and reports invalid response', async () => {
    const provider: BriefingChat = vi.fn(async () => '   ')
    const response = await request({ facts }, provider)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_PROVIDER_RESPONSE' })
  })
})
