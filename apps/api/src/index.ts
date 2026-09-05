import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { handleOrder, type OrderProvider } from './order'
import { handleParse, type ParseChat } from './parse'
import { handleBriefing, type BriefingChat } from './briefing'
import { createChat } from './chat'
import { createOpenAiCompatibleProvider } from './provider'
import { dayKey, deviceIdFrom, readQuota, recordUsage } from './quota'
import { handleLogin, handleLogout, handleMe, handleRegister, bearerToken, findUserByEmail, setUserPlan, userForToken } from './auth-routes'
import type { AuthD1, Plan, UserRow } from './auth-routes'
type Bindings = {
  PARSE_PROVIDER?: Parameters<typeof handleParse>[1]
  BRIEFING_PROVIDER?: Parameters<typeof handleBriefing>[1]
  LLM_API_KEY?: string
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  ORDER_PROVIDER?: OrderProvider
  DB?: AuthD1
  FREE_DAILY_LIMIT?: string
  PRO_DAILY_LIMIT?: string
  ADMIN_KEY?: string
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
// their account (so the quota follows them across devices) and paid plans
// get a higher daily allowance; anonymous users count by device. The
// DB-absent case fails open so the product keeps working before phase-2
// storage is configured.
// Quota limit for a user: paid plans get the pro allowance while active.
function limitForUser(env: Bindings | undefined, user: UserRow): number {
  const paidActive = (user.plan === 'monthly' || user.plan === 'yearly') && (!user.plan_expires_at || Date.parse(user.plan_expires_at) > Date.parse(new Date().toISOString()))
  return paidActive ? proDailyLimit(env) : freeLimit(env)
}

async function quotaGate(context: Context<{ Bindings: Bindings }>): Promise<QuotaResult> {
  const authHeader = context.req.header('Authorization')
  const sessionToken = bearerToken(authHeader)
  let accountKey: string | null = null
  let accountUser: UserRow | null = null
  if (sessionToken && context.env?.DB) {
    try {
      const user = await userForToken(context.env.DB as unknown as AuthD1, sessionToken, new Date().toISOString())
      if (user) {
        accountKey = `user:${user.id}`
        accountUser = user
      }
    } catch { /* fall through to device counting */ }
  }
  const deviceId = deviceIdFrom(context.req.header('X-LifeFlow-Device'))
  const identity = accountKey ?? deviceId
  if (!identity) {
    return { ok: false, response: context.json({ ok: false, error: 'DEVICE_ID_REQUIRED' }, 401) }
  }
  const day = dayKey(new Date().toISOString())
  const limit = accountUser ? limitForUser(context.env, accountUser) : freeLimit(context.env)
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

function proDailyLimit(env?: Bindings): number {
  const parsed = Number(env?.PRO_DAILY_LIMIT ?? 200)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200
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
  const sessionToken = bearerToken(context.req.header('Authorization'))
  let identity: string | null = null
  let accountUser: UserRow | null = null
  if (sessionToken && context.env?.DB) {
    try {
      const user = await userForToken(context.env.DB, sessionToken, new Date().toISOString())
      if (user) { identity = `user:${user.id}`; accountUser = user }
    } catch { /* fall through to device identity */ }
  }
  if (!identity) identity = deviceIdFrom(context.req.header('X-LifeFlow-Device'))
  if (!identity) return context.json({ ok: false, error: 'DEVICE_ID_REQUIRED' }, 401)
  const day = dayKey(new Date().toISOString())
  const limit = accountUser ? limitForUser(context.env, accountUser) : freeLimit(context.env)
  const snapshot = await readQuota(context.env?.DB, identity, day, limit)
  return context.json({ ok: true, ...snapshot })
})

app.post('/v1/auth/register', (context) => handleRegister(context))
app.post('/v1/auth/login', (context) => handleLogin(context))
app.post('/v1/auth/logout', (context) => handleLogout(context))
app.get('/v1/auth/me', (context) => handleMe(context))

// Manual plan granting until payment integration arrives: a request with the
// admin secret sets a user's plan. Payment callbacks will replace this.
app.post('/v1/admin/plan', async (context) => {
  const adminKey = context.env?.ADMIN_KEY
  if (!adminKey || context.req.header('X-Admin-Key') !== adminKey) {
    return context.json({ ok: false, error: 'FORBIDDEN' }, 403)
  }
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400) }
  const value = body as { email?: unknown; plan?: unknown; days?: unknown }
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : null
  if (!email || !(value.plan === 'monthly' || value.plan === 'yearly' || value.plan === 'free')) {
    return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400)
  }
  const days = typeof value.days === 'number' && value.days > 0 ? Math.min(3650, Math.floor(value.days)) : 30
  if (!context.env?.DB) return context.json({ ok: false, error: 'ACCOUNTS_UNAVAILABLE' }, 503)
  const user = await setUserPlan(context.env.DB, email, value.plan, days, new Date().toISOString())
  if (!user) return context.json({ ok: false, error: 'USER_NOT_FOUND' }, 404)
  return context.json({ ok: true, email: user.email, plan: user.plan, planExpiresAt: user.plan_expires_at })
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
