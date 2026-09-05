import { describe, expect, it } from 'vitest'
import app from './index'
import type { AuthD1 } from './auth-routes'

const ADMIN_KEY = 'admin-secret'
const EMAIL = 'pro@example.com'
const PASSWORD = 'long-enough-password'

// In-memory D1 fake with users/sessions/ai_usage (same shape as auth tests).
function fakeD1(): AuthD1 & { ai_usage: Map<string, number>; users: Map<string, { planExpiresAt: string | null }> } {
  const users = new Map<string, { id: string; email: string; passwordHash: string; plan: string; planExpiresAt: string | null }>()
  const emailIndex = new Map<string, string>()
  const sessions = new Map<string, { userId: string; expiresAt: string }>()
  const ai_usage = new Map<string, number>()
  return {
    ai_usage,
    users,
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (query.includes('FROM users WHERE email')) {
                const id = emailIndex.get(values[0] as string)
                const user = id ? users.get(id) : undefined
                return user ? { id: user.id, email: user.email, password_hash: user.passwordHash, created_at: '', plan: user.plan, plan_expires_at: user.planExpiresAt } as T : null
              }
              if (query.includes('FROM users WHERE id')) {
                const user = users.get(values[0] as string)
                return user ? { id: user.id, email: user.email, password_hash: user.passwordHash, created_at: '', plan: user.plan, plan_expires_at: user.planExpiresAt } as T : null
              }
              if (query.includes('FROM sessions WHERE token_hash')) {
                const session = sessions.get(values[0] as string)
                return session ? { token_hash: values[0] as string, user_id: session.userId, expires_at: session.expiresAt } as T : null
              }
              if (query.includes('FROM ai_usage')) {
                return { count: ai_usage.get(`${values[0]}|${values[1]}`) ?? 0 } as T
              }
              return null
            },
            async all<T>(): Promise<{ results?: T[] }> { return { results: [] } },
            async run(): Promise<unknown> {
              if (query.includes('UPDATE users SET plan')) {
                const [plan, expiresAt, id] = values as [string, string | null, string]
                const user = users.get(id)
                if (user) { user.plan = plan; user.planExpiresAt = expiresAt }
              }
              if (query.includes('INSERT INTO users')) {
                const [id, email, passwordHash, createdAt, plan, planExpiresAt] = values as [string, string, string, string, string, string | null]
                users.set(id, { id, email, passwordHash, plan, planExpiresAt })
                emailIndex.set(email, id)
              }
              if (query.includes('INSERT INTO sessions')) {
                const [tokenHashValue, userId, expiresAt] = values as [string, string, string]
                sessions.set(tokenHashValue, { userId, expiresAt })
              }
              if (query.includes('ON CONFLICT (device_id, day)')) {
                const key = `${values[0]}|${values[1]}`
                ai_usage.set(key, (ai_usage.get(key) ?? 0) + 1)
              }
              return null
            },
          }
        },
      }
    },
  }
}

async function registerAndLogin(proEmail?: string): Promise<{ token: string; env: Record<string, unknown> }> {
  const db = fakeD1()
  const env = { DB: db, FREE_DAILY_LIMIT: '20', PRO_DAILY_LIMIT: '200', ADMIN_KEY: ADMIN_KEY }
  await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: proEmail ?? EMAIL, password: PASSWORD }) }, env)
  const login = await app.request('http://localhost/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: proEmail ?? EMAIL, password: PASSWORD }) }, env)
  const { token } = await login.json() as { token: string }
  return { token, env }
}

const PARSE_ENV_WITH_PROVIDER = (env: Record<string, unknown>) => ({ ...env, PARSE_PROVIDER: async () => JSON.stringify({ drafts: [{ title: '解析出的任务' }], reply: '好的' }) })

describe('subscription plans', () => {
  it('free users get the free daily limit', async () => {
    const { token, env } = await registerAndLogin()
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
    const quota = await app.request('http://localhost/v1/ai/quota', { headers }, env)
    const data = await quota.json() as { limit: number; mode: string }
    expect(data.limit).toBe(20)
    void headers
  })

  it('an admin grant switches the account to the paid limit', async () => {
    const { token, env } = await registerAndLogin()
    const grant = await app.request('http://localhost/v1/admin/plan', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Admin-Key': ADMIN_KEY }, body: JSON.stringify({ email: EMAIL, plan: 'monthly', days: 30 }) }, env)
    expect(grant.status).toBe(200)
    const quota = await app.request('http://localhost/v1/ai/quota', { headers: { authorization: `Bearer ${token}` } }, env)
    const data = await quota.json() as { limit: number }
    expect(data.limit).toBe(200)
  })

  it('rejects admin grants with a wrong or missing admin key', async () => {
    const { env } = await registerAndLogin()
    const noKey = await app.request('http://localhost/v1/admin/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, plan: 'monthly' }) }, env)
    expect(noKey.status).toBe(403)
    const wrongKey = await app.request('http://localhost/v1/admin/plan', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Admin-Key': 'wrong' }, body: JSON.stringify({ email: EMAIL, plan: 'monthly' }) }, env)
    expect(wrongKey.status).toBe(403)
  })

  it('falls back to the free limit when the paid plan expires', async () => {
    const db = fakeD1()
    const env = { DB: db, FREE_DAILY_LIMIT: '20', PRO_DAILY_LIMIT: '200', ADMIN_KEY: ADMIN_KEY }
    await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }, env)
    // 到期时间设在过去
    await app.request('http://localhost/v1/admin/plan', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Admin-Key': ADMIN_KEY }, body: JSON.stringify({ email: EMAIL, plan: 'monthly', days: 30 }) }, { ...env, ADMIN_KEY: ADMIN_KEY })
    const expiredAt = new Date(Date.parse('2026-08-01T00:00:00.000Z')).toISOString()
    const rows = fakeD1()
    void rows; void expiredAt
    // 直接改到期时间为过去
    const allUsers = [...db.users.values()]
    allUsers.forEach((user) => { user.planExpiresAt = '2026-08-01T00:00:00.000Z' })
    const login = await app.request('http://localhost/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }, env)
    const { token } = await login.json() as { token: string }
    const quota = await app.request('http://localhost/v1/ai/quota', { headers: { authorization: `Bearer ${token}` } }, env)
    const data = await quota.json() as { limit: number }
    expect(data.limit).toBe(20)
  })

  it('me reports the active plan', async () => {
    const { token, env } = await registerAndLogin()
    await app.request('http://localhost/v1/admin/plan', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Admin-Key': ADMIN_KEY }, body: JSON.stringify({ email: EMAIL, plan: 'yearly', days: 365 }) }, env)
    const me = await app.request('http://localhost/v1/auth/me', { headers: { authorization: `Bearer ${token}` } }, env)
    const data = await me.json() as { plan: string; planExpiresAt: string | null }
    expect(data.plan).toBe('yearly')
    expect(data.planExpiresAt).toBeTruthy()
  })
})
