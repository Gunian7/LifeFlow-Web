import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { handleOrder, type OrderProvider } from './order'
import { handleParse, type ParseChat } from './parse'
import { handleBriefing, type BriefingChat } from './briefing'
import { createChat } from './chat'
import { createOpenAiCompatibleProvider } from './provider'
import { dayKey, deviceIdFrom, readQuota, recordUsage } from './quota'
import { handleLogin, handleLogout, handleMe, handleRegister, bearerToken, userForToken } from './auth-routes'
import type { AuthD1 } from './auth-routes'
type Bindings = {
  PARSE_PROVIDER?: Parameters<typeof handleParse>[1]
  BRIEFING_PROVIDER?: Parameters<typeof handleBriefing>[1]
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  ORDER_PROVIDER?: OrderProvider
  DB?: AuthD1
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
  | { ok: true; identity: string; day: string; remaining: number; mode: 'enforced' | 'unconfigured' }
  | { ok: false; response: Response }

// Every AI endpoint goes through this gate. Logged-in users are counted by
// their account (so the quota follows them across devices); anonymous users
// by device. The DB-absent case fails open so the product keeps working
// before phase-2 storage is configured.
async function quotaGate(context: Context<{ Bindings: Bindings }>): Promise<QuotaResult> {
  const authHeader = context.req.header('Authorization')
  const sessionToken = bearerToken(authHeader)
  let accountKey: string | null = null
  if (sessionToken && context.env?.DB) {
    try {
      const user = await userForToken(context.env.DB as unknown as AuthD1, sessionToken, new Date().toISOString())
      if (user) accountKey = `user:${user.id}`
    } catch { /* fall through to device counting */ }
  }
  const deviceId = deviceIdFrom(context.req.header('X-LifeFlow-Device'))
  const identity = accountKey ?? deviceId
  if (!identity) {
    return { ok: false, response: context.json({ ok: false, error: 'DEVICE_ID_REQUIRED' }, 401) }
  }
  const day = dayKey(new Date().toISOString())
  const limit = freeLimit(context.env)
  let snapshot
  try {
    snapshot = await readQuota(context.env?.DB, identity, day, limit)
  } catch {
    return { ok: false, response: context.json({ ok: false, error: 'QUOTA_STORE_UNAVAILABLE' }, 503) }
  }
  if (snapshot.mode === 'enforced' && snapshot.remaining <= 0) {
    return { ok: false, response: context.json({ ok: false, error: 'QUOTA_EXCEEDED', used: snapshot.used, limit: snapshot.limit }, 429) }
  }
  return { ok: true, identity, day, remaining: snapshot.remaining, mode: snapshot.mode }
}

function finish(context: { env?: Bindings }, quota: Extract<QuotaResult, { ok: true }>, response: Response): Response {
  if (response.status === 200 && quota.mode === 'enforced') {
    void recordUsage(context.env?.DB, quota.identity, quota.day)
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

app.post('/v1/auth/register', (context) => handleRegister(context))
app.post('/v1/auth/login', (context) => handleLogin(context))
app.post('/v1/auth/logout', (context) => handleLogout(context))
app.get('/v1/auth/me', (context) => handleMe(context))

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
