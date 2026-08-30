import { describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import type { OrderProvider } from '../src/order'

const validBody = {
  tasks: [
    { id: 'report', title: '写报告', durationMinutes: 90, importance: 'must' },
    { id: 'walk', title: '散步', durationMinutes: 30, importance: 'want' },
  ],
}

async function request(body: unknown, provider?: OrderProvider): Promise<Response> {
  return app.request('http://localhost/v1/ai/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, provider ? { ORDER_PROVIDER: provider } : undefined)
}

describe('LifeFlow AI order endpoint', () => {
  it('accepts a valid order-only response from an injected provider', async () => {
    const provider: OrderProvider = vi.fn(async () => JSON.stringify({ order: ['report', 'walk'], reason: '先处理必须事项。' }))
    const response = await request(validBody, provider)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, order: ['report', 'walk'], reason: '先处理必须事项。' })
  })

  it('rejects an empty task list', async () => {
    const response = await request({ tasks: [] })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
  })

  it('rejects a task without a title or id', async () => {
    const response = await request({ tasks: [{ id: '', title: '', durationMinutes: 20, importance: 'want' }] })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
  })

  it('rejects more than twenty tasks', async () => {
    const tasks = Array.from({ length: 21 }, (_, index) => ({ id: `task-${index}`, title: `任务${index}`, durationMinutes: 10, importance: 'want' }))
    const response = await request({ tasks })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
  })

  it('rejects a provider order with missing or duplicate ids', async () => {
    const provider: OrderProvider = vi.fn(async () => JSON.stringify({ order: ['report', 'report'], reason: '错误答案' }))
    const response = await request(validBody, provider)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, error: 'INVALID_PROVIDER_RESPONSE' })
  })

  it('rejects provider-created ids and silently excludes extra fields from the provider input', async () => {
    const provider: OrderProvider = vi.fn(async (tasks) => {
      expect(tasks).toEqual(validBody.tasks)
      return JSON.stringify({ order: ['report', 'walk'], reason: '仅调整顺序。' })
    })
    const response = await request({ tasks: validBody.tasks.map((task) => ({ ...task, notes: '私密备注', place: '家里', deadlineAt: 'tomorrow' })) }, provider)
    expect(response.status).toBe(200)
  })

  it('passes scheduling context to the provider and drops unknown fields', async () => {
    const provider: OrderProvider = vi.fn(async (_tasks, context) => {
      expect(context).toEqual({ now: '2026-08-30T03:00:00.000Z', windowEndLocalTime: '23:30' })
      return JSON.stringify({ order: ['report', 'walk'], reason: '按剩余时间安排。' })
    })
    const response = await request({ ...validBody, context: { now: '2026-08-30T03:00:00.000Z', windowEndLocalTime: '23:30', junk: true } }, provider)
    expect(response.status).toBe(200)
  })

  it('does not echo an upstream failure body', async () => {
    const provider: OrderProvider = vi.fn(async () => { throw new Error('secret upstream body') })
    const response = await request(validBody, provider)
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).not.toContain('secret upstream body')
    expect(body).toContain('PROVIDER_UNAVAILABLE')
  })
})
