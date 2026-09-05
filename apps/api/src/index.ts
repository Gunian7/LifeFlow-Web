import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { handleOrder, type OrderProvider } from './order'
import { handleParse, type ParseChat } from './parse'
import { handleBriefing, type BriefingChat } from './briefing'
import { createChat } from './chat'
import { createOpenAiCompatibleProvider } from './provider'
import { dayKey, deviceIdFrom, readQuota, recordUsage } from './quota'

type Bindings = {
  PARSE_PROVIDER?: Parameters<typeof handleParse>[1]
  BRIEFING_PROVIDER?: Parameters<typeof handleBriefing>[1]
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  ORDER_PROVIDER?: OrderProvider
  DB?: Parameters<typeof readQuota>[0]
  FREE_DAILY_LIMIT?: string
}

const app = new Hono<{ Bindings: Bindings }>()

const allowedOrigins = [
  'https://gunian7.github.io',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]

app.use('*', cors({
  origin: allowedOrigins,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-LifeFlow-Device'],
  exposeHeaders: ['X-Quota-Remaining', 'X-Quota-Mode'],
}))

function freeLimit(env?: Bindings): number {
  const parsed = Number(env?.FREE_DAILY_LIMIT ?? 20)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20
}

type QuotaResult =
  | { ok: true; deviceId: string; day: string; remaining: number; mode: 'enforced' | 'unconfigured' }
  | { ok: false; response: Response }

// Every AI endpoint goes through this gate: a device header identifies the
// caller, the daily counter caps the free allowance, and the DB-absent case
// fails open so the product keeps working before phase-2 accounts arrive.
async function quotaGate(context: Context<{ Bindings: Bindings }>): Promise<QuotaResult> {
  const deviceId = deviceIdFrom(context.req.header('X-LifeFlow-Device'))
  if (!deviceId) {
    return { ok: false, response: context.json({ ok: false, error: 'DEVICE_ID_REQUIRED' }, 401) }
  }
  const day = dayKey(new Date().toISOString())
  const limit = freeLimit(context.env)
  let snapshot
  try {
    snapshot = await readQuota(context.env?.DB, deviceId, day, limit)
  } catch {
    return { ok: false, response: context.json({ ok: false, error: 'QUOTA_STORE_UNAVAILABLE' }, 503) }
  }
  if (snapshot.mode === 'enforced' && snapshot.remaining <= 0) {
    return { ok: false, response: context.json({ ok: false, error: 'QUOTA_EXCEEDED', used: snapshot.used, limit: snapshot.limit }, 429) }
  }
  return { ok: true, deviceId, day, remaining: snapshot.remaining, mode: snapshot.mode }
}

function finish(context: { env?: Bindings }, quota: Extract<QuotaResult, { ok: true }>, response: Response): Response {
  if (response.status === 200 && quota.mode === 'enforced') {
    void recordUsage(context.env?.DB, quota.deviceId, quota.day)
  }
  response.headers.set('X-Quota-Remaining', String(quota.mode === 'enforced' ? Math.max(0, quota.remaining - (response.status === 200 ? 1 : 0)) : quota.remaining))
  response.headers.set('X-Quota-Mode', quota.mode)
  return response
}

app.get('/health', (context) => context.json({ ok: true, service: 'lifeflow-api' }))

app.get('/v1/ai/quota', async (context) => {
  const deviceId = deviceIdFrom(context.req.header('X-LifeFlow-Device'))
  if (!deviceId) return context.json({ ok: false, error: 'DEVICE_ID_REQUIRED' }, 401)
  const day = dayKey(new Date().toISOString())
  const limit = freeLimit(context.env)
  const snapshot = await readQuota(context.env?.DB, deviceId, day, limit)
  return context.json({ ok: true, ...snapshot })
})

app.post('/v1/ai/order', async (context) => {
  const gate = await quotaGate(context)
  if (!gate.ok) return gate.response
  const injected = context.env?.ORDER_PROVIDER
  const provider = injected ?? (context.env?.LLM_API_KEY ? createOpenAiCompatibleProvider({ apiKey: context.env.LLM_API_KEY, baseUrl: context.env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: context.env.LLM_MODEL ?? 'gpt-4o-mini' }) : undefined)
  return finish(context, gate, await handleOrder(context, provider))
})

app.post('/v1/ai/parse', async (context) => {
  const gate = await quotaGate(context)
  if (!gate.ok) return gate.response
  const chat = context.env?.PARSE_PROVIDER ?? envChat(context.env)
  return finish(context, gate, await handleParse(context, chat))
})

app.post('/v1/ai/briefing', async (context) => {
  const gate = await quotaGate(context)
  if (!gate.ok) return gate.response
  const chat = context.env?.BRIEFING_PROVIDER ?? envChat(context.env)
  return finish(context, gate, await handleBriefing(context, chat))
})

function envChat(env?: Bindings) {
  if (!env?.LLM_API_KEY) return undefined
  return createChat({ apiKey: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1', model: env.LLM_MODEL ?? 'gpt-4o-mini' })
}

export default app
