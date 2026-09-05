import type { Context } from 'hono'
import { createChat } from './chat'
import type { ProviderOptions } from './provider'

export interface BriefingFacts {
  date: string
  taskCount: number
  mustCount: number
  firstTask?: { title: string; startLocal: string }
  unscheduledCount: number
  deferredCount: number
  carriedCount: number
  bufferMinutes: number
  restWindow?: { start: string; end: string }
  windowStart: string
  windowEnd: string
}

export type BriefingChat = (prompt: string) => Promise<string>

const MAX_CHARS = 600

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_CHARS) : null
}

// The briefing may only rephrase the facts the local planner already knows.
// Anything the model invents is discarded by falling back to the caller's
// local rendering.
export function cleanBriefingText(raw: string): string | null {
  const text = cleanText(raw)
  if (!text) return null
  return text
}

export function buildBriefingPrompt(facts: BriefingFacts): string {
  return [
    'You are the morning voice of a calm, non-judgmental day planner called LifeFlow.',
    'Write a warm Chinese morning briefing of 2-4 short sentences based ONLY on the facts given.',
    'Rules: never blame; never mention productivity scores; acknowledge honestly when things did not fit; mention the must-do tasks; end gently.',
    'Do not invent tasks or facts that are not in the data.',
    JSON.stringify({ facts }),
  ].join('\n')
}

interface BriefingBindings {
  BRIEFING_PROVIDER?: BriefingChat
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
}

function envChat(env?: BriefingBindings): BriefingChat | undefined {
  if (!env?.LLM_API_KEY) return undefined
  const options: ProviderOptions = { apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: env.LLM_MODEL ?? 'gpt-4o-mini' }
  return createChat(options)
}

export async function handleBriefing(context: Context<{ Bindings: BriefingBindings }>, chatOverride?: BriefingChat): Promise<Response> {
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400) }
  const facts = (body as { facts?: unknown }).facts
  if (!facts || typeof facts !== 'object') return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400)
  const chat = chatOverride ?? context.env?.BRIEFING_PROVIDER ?? envChat(context.env)
  if (!chat) return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502)
  let raw: string
  try { raw = await chat(buildBriefingPrompt(facts as BriefingFacts)) } catch { return context.json({ ok: false, error: 'PROVIDER_UNAVAILABLE' }, 502) }
  const text = cleanBriefingText(raw)
  if (!text) return context.json({ ok: false, error: 'INVALID_PROVIDER_RESPONSE' }, 502)
  return context.json({ ok: true, text })
}
