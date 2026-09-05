import type { Context } from 'hono'
import type { ChatFn } from './chat'
import type { ProviderOptions } from './provider'

export interface SubtaskDraft { title: string; minutes: number }

export type BreakdownChat = (prompt: string) => Promise<string>

interface BreakdownBindings {
  BREAKDOWN_PROVIDER?: BreakdownChat
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
}

function envChat(env?: BreakdownBindings): BreakdownChat | undefined {
  if (!env?.LLM_API_KEY) return undefined
  const fetcher = fetch
  const options: ProviderOptions = { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: env.LLM_MODEL ?? 'gpt-4o-mini' }
  return async (prompt: string): Promise<string> => {
    let response: Response
    try {
      response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ model: options.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      })
    } catch {
      throw new Error('PROVIDER_REQUEST_FAILED')
    }
    if (!response.ok) throw new Error('PROVIDER_REQUEST_FAILED')
    let parsed: { choices?: Array<{ message?: { content?: unknown } }> }
    try { parsed = await response.json() as typeof parsed } catch { throw new Error('PROVIDER_REQUEST_FAILED') }
    const content = parsed.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('PROVIDER_REQUEST_FAILED')
    return content
  }
}

export function buildBreakdownPrompt(title: string, minutes: number): string {
  return [
    'You are a task-decomposition assistant for a calm, realistic day planner.',
    `Break the following task into 2-5 concrete subtasks. Each subtask should take 15-60 minutes. The total should roughly equal ${minutes} minutes.`,
    'Subtasks must be actionable steps, not vague restatements.',
    'Return JSON only with this exact shape: {"subtasks":[{"title":"...","minutes":25}],"reply":"一句中文说明"}.',
    'Do not create tasks beyond the breakdown.',
    JSON.stringify({ title, minutes }),
  ].join('\n')
}

export function parseSubtasks(raw: string): Array<{ title: string; minutes: number }> | null {
  let parsed: { subtasks?: unknown }
  try { parsed = JSON.parse(raw) as typeof parsed } catch { return null }
  if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length < 2 || parsed.subtasks.length > 6) return null
  const result: Array<{ title: string; minutes: number }> = []
  for (const item of parsed.subtasks) {
    if (!item || typeof item !== 'object') return null
    const value = item as { title?: unknown; minutes?: unknown }
    if (typeof value.title !== 'string' || !value.title.trim()) return null
    const mins = typeof value.minutes === 'number' && Number.isInteger(value.minutes) && value.minutes > 0 ? value.minutes : 0
    if (mins <= 0) return null
    result.push({ title: value.title.trim().slice(0, 100), minutes: mins })
  }
  return result
}

export async function handleBreakdown(context: Context<{ Bindings: BreakdownBindings }>): Promise<Response> {
  const raw = await context.req.json().catch(() => null) as { title?: unknown; minutes?: unknown } | null
  const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 200) : null
  const minutes = typeof raw?.minutes === 'number' && Number.isInteger(raw.minutes) && raw.minutes > 0 ? raw.minutes : null
  if (!title || !minutes) return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400)
  const chat = context.env?.BREAKDOWN_PROVIDER ?? envChat(context.env)
  if (!chat) return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502)
  const modelReply = await chat(buildBreakdownPrompt(title, minutes)).catch(() => null)
  if (modelReply === null) return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502)
  const subtasks = parseSubtasks(modelReply)
  if (!subtasks) return context.json({ ok: false, error: 'INVALID_PROVIDER_RESPONSE' }, 502)
  return context.json({ ok: true, subtasks })
}
