import type { Context } from 'hono'
import { createChat } from './chat'
import type { ProviderOptions } from './provider'

export interface ParsedDraft {
  title: string
  date?: string
  pinTime?: string
  minutes?: number
  place?: string
  notes?: string
}

export interface ParseResult {
  drafts: ParsedDraft[]
  reply: string
}

export type ParseChat = (prompt: string) => Promise<string>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

// Strict validation: the model may only fill known fields with well-formed
// values; anything else is dropped so a hallucinated field never reaches the
// user's task form.
function sanitizeDraft(raw: unknown): ParsedDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const title = cleanString(value.title, 100)
  if (!title) return null
  const draft: ParsedDraft = { title }
  const date = cleanString(value.date, 10)
  if (date && DATE_RE.test(date)) draft.date = date
  const pinTime = cleanString(value.pinTime, 5)
  if (pinTime && TIME_RE.test(pinTime)) draft.pinTime = pinTime
  if (typeof value.minutes === 'number' && Number.isInteger(value.minutes) && value.minutes > 0 && value.minutes <= 1440) draft.minutes = value.minutes
  const place = cleanString(value.place, 100)
  if (place) draft.place = place
  const notes = cleanString(value.notes, 300)
  if (notes) draft.notes = notes
  return draft
}

export function parseProviderResponse(raw: string): ParseResult | null {
  let parsed: { drafts?: unknown; reply?: unknown }
  try { parsed = JSON.parse(raw) as typeof parsed } catch { return null }
  if (!Array.isArray(parsed.drafts) || typeof parsed.reply !== 'string') return null
  const drafts: ParsedDraft[] = []
  for (const raw of parsed.drafts.slice(0, 5)) {
    const draft = sanitizeDraft(raw)
    if (draft) drafts.push(draft)
  }
  if (drafts.length === 0) return null
  return { drafts, reply: parsed.reply.slice(0, 300) }
}

export function buildParsePrompt(text: string, now: string, timezone: string): string {
  return [
    'You are a task-capture assistant for a calm, realistic day planner.',
    'Parse the user\'s message into task drafts. Resolve relative dates (今天/明天/下周三) against the current time and timezone.',
    'The user will review every draft before it is saved, so keep titles as the user phrased them.',
    'Return JSON only with this exact shape: {"drafts":[{"title":"...","date":"YYYY-MM-DD","pinTime":"HH:MM","minutes":30,"place":"...","notes":"..."}],"reply":"一句中文确认"} .',
    'Omit fields the message does not mention. No more than 5 drafts. date must be YYYY-MM-DD; pinTime must be HH:MM; minutes must be an integer.',
    JSON.stringify({ message: text, now, timezone }),
  ].join('\n')
}

interface ParseBindings {
  PARSE_PROVIDER?: ParseChat
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
}

function envChat(env?: ParseBindings): ParseChat | undefined {
  if (!env?.LLM_API_KEY) return undefined
  const options: ProviderOptions = { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: env.LLM_MODEL ?? 'gpt-4o-mini' }
  return createChat(options)
}

export async function handleParse(context: Context<{ Bindings: ParseBindings }>, chatOverride?: ParseChat): Promise<Response> {
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400) }
  const value = body as { text?: unknown; now?: unknown; timezone?: unknown }
  if (typeof value?.text !== 'string' || !value.text.trim() || typeof value?.now !== 'string' || Number.isNaN(Date.parse(value.now))) {
    return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400)
  }
  const text = value.text.trim().slice(0, 500)
  const timezone = typeof value.timezone === 'string' ? value.timezone.slice(0, 40) : 'Asia/Shanghai'
  const chat = chatOverride ?? context.env?.PARSE_PROVIDER ?? envChat(context.env)
  if (!chat) return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502)
  let raw: string
  try { raw = await chat(buildParsePrompt(text, value.now, timezone)) } catch { return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502) }
  const result = parseProviderResponse(raw)
  if (!result) return context.json({ ok: false, error: 'INVALID_PROVIDER_RESPONSE' }, 502)
  return context.json({ ok: true, drafts: result.drafts, reply: result.reply })
}
