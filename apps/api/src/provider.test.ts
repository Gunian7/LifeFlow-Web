import { describe, expect, it, vi } from 'vitest'
import { createOpenAiCompatibleProvider } from '../src/provider'

const tasks = [{ id: 'a', title: '写报告', durationMinutes: 60, importance: 'must' as const }]

describe('OpenAI-compatible provider adapter', () => {
  it('sends the ordering prompt with task data and context, and parses the content', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> }
      expect(body.model).toBe('test-model')
      expect(body.messages[0].content).toContain('写报告')
      expect(body.messages[0].content).toContain('windowEndLocalTime')
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"order":["a"],"reason":"先处理必须事项。"}' } }] }), { status: 200 })
    })
    const provider = createOpenAiCompatibleProvider({ apiKey: 'secret-not-logged', baseUrl: 'https://example.test/v1', model: 'test-model', fetcher })
    await expect(provider(tasks, { now: '2026-08-30T03:00:00.000Z', windowEndLocalTime: '23:30' })).resolves.toContain('"order"')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('uses the completions endpoint and authorization header', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.test/v1/chat/completions')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret')
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 })
    })
    const provider = createOpenAiCompatibleProvider({ apiKey: 'secret', baseUrl: 'https://example.test/v1/', model: 'model', fetcher })
    await provider(tasks, {})
  })

  it('throws a generic provider error without including response body', async () => {
    const fetcher = vi.fn(async () => new Response('private upstream details', { status: 500 }))
    const provider = createOpenAiCompatibleProvider({ apiKey: 'secret', baseUrl: 'https://example.test/v1', model: 'model', fetcher })
    await expect(provider(tasks)).rejects.toThrow('PROVIDER_REQUEST_FAILED')
  })
})
