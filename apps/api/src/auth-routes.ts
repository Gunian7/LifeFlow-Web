import type { Context } from 'hono'
import type { D1Like } from './quota'
import { hashPassword, newSalt, newSessionToken, newUserId, readCredentials, sessionExpiry, sessionValid, tokenHash, verifyPassword } from './auth'
import { claimCode, codeDigest } from './redeem'

export interface UserRow { id: string; email: string; password_hash: string; created_at: string; plan: string; plan_expires_at: string | null }
export interface SessionRow { token_hash: string; user_id: string; expires_at: string }

export type Plan = 'free' | 'monthly' | 'yearly'

export function isPlan(value: unknown): value is Plan {
  return value === 'free' || value === 'monthly' || value === 'yearly'
}

export interface AuthD1 {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      all<T>(): Promise<{ results?: T[] }>
      run(): Promise<unknown>
    }
  }
}

export async function findUserByEmail(db: AuthD1, email: string): Promise<UserRow | null> {
  return await db.prepare('SELECT id, email, password_hash, created_at, plan, plan_expires_at FROM users WHERE email = ?1').bind(email).first<UserRow>()
}

export async function createUser(db: AuthD1, email: string, password: string, now: string): Promise<UserRow> {
  const user: UserRow = { id: newUserId(), email, password_hash: await hashPassword(password, newSalt()), created_at: now, plan: 'free', plan_expires_at: null }
  await db.prepare('INSERT INTO users (id, email, password_hash, created_at, plan, plan_expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(user.id, user.email, user.password_hash, user.created_at, user.plan, user.plan_expires_at).run()
  return user
}

export async function createSession(db: AuthD1, userId: string, now: string): Promise<string> {
  const token = newSessionToken()
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)').bind(await tokenHash(token), userId, sessionExpiry(now)).run()
  return token
}

export async function userForToken(db: AuthD1, token: string, now: string): Promise<UserRow | null> {
  const session = await db.prepare('SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ?1').bind(await tokenHash(token)).first<SessionRow>()
  if (!session || !sessionValid(session.expires_at, now)) return null
  return await db.prepare('SELECT id, email, password_hash, created_at, plan, plan_expires_at FROM users WHERE id = ?1').bind(session.user_id).first<UserRow>()
}

export async function findUserById(db: AuthD1, id: string): Promise<UserRow | null> {
  return await db.prepare('SELECT id, email, password_hash, created_at, plan, plan_expires_at FROM users WHERE id = ?1').bind(id).first<UserRow>()
}

// Manual plan granting (payment integration arrives in a later phase; until
// then an admin key grants plans by email).
export async function setUserPlan(db: AuthD1, email: string, plan: Plan, days: number, now: string): Promise<UserRow | null> {
  const user = await findUserByEmail(db, email)
  if (!user) return null
  const expiresAt = plan === 'free' ? null : new Date(Date.parse(now) + days * 86400000).toISOString()
  await db.prepare('UPDATE users SET plan = ?1, plan_expires_at = ?2 WHERE id = ?3').bind(plan, expiresAt, user.id).run()
  return { ...user, plan, plan_expires_at: expiresAt }
}

// 兑换码核销：把码绑到当前登录账号上，同时更新账号套餐。
export async function redeemForUser(db: AuthD1, code: string, userId: string, now: string): Promise<{ plan: Plan; days: number } | null> {
  const hash = await codeHashOf(code)
  const claimed = await db.prepare('UPDATE redeem_codes SET used_by = ?1, used_at = ?2 WHERE code_hash = ?3 AND used_by IS NULL RETURNING plan, days').bind(userId, now, hash).first<{ plan: Plan; days: number }>()
  if (!claimed) return null
  const expiresAt = new Date(Date.parse(now) + claimed.days * 86400000).toISOString()
  await db.prepare('UPDATE users SET plan = ?1, plan_expires_at = ?2 WHERE id = ?3').bind(claimed.plan, expiresAt, userId).run()
  return claimed
}

async function codeHashOf(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function handleRedeem(context: Context<{ Bindings: { DB?: AuthD1 } }>): Promise<Response> {
  const db = context.env?.DB
  if (!db) return context.json({ ok: false, error: 'ACCOUNTS_UNAVAILABLE' }, 503)
  const token = bearerToken(context.req.header('Authorization'))
  if (!token) return context.json({ ok: false, error: 'UNAUTHORIZED' }, 401)
  const user = await userForToken(db, token, new Date().toISOString())
  if (!user) return context.json({ ok: false, error: 'UNAUTHORIZED' }, 401)
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400) }
  const code = typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code.trim() : null
  if (!code || code.length < 8 || code.length > 40) return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400)
  const claimed = await redeemForUser(db, code, user.id, new Date().toISOString())
  if (!claimed) return context.json({ ok: false, error: 'CODE_INVALID_OR_USED' }, 404)
  return context.json({ ok: true, plan: claimed.plan, days: claimed.days })
}

export async function deleteSession(db: AuthD1, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await tokenHash(token)).run()
}

export function bearerToken(headerValue: string | undefined): string | null {
  if (!headerValue?.startsWith('Bearer ')) return null
  const token = headerValue.slice(7).trim()
  return token && token.length >= 32 ? token : null
}

// Shared registration/login logic. Returns either a session token + email or
// an error code the route turns into a status.
export type AuthOutcome = { ok: true; token: string; email: string } | { ok: false; error: 'INVALID_REQUEST' | 'EMAIL_TAKEN' | 'BAD_CREDENTIALS' }

export async function registerAccount(db: AuthD1, body: unknown): Promise<AuthOutcome> {
  const credentials = readCredentials(body)
  if (!credentials) return { ok: false, error: 'INVALID_REQUEST' }
  const now = new Date().toISOString()
  if (await findUserByEmail(db, credentials.email)) return { ok: false, error: 'EMAIL_TAKEN' }
  const user = await createUser(db, credentials.email, credentials.password, now)
  return { ok: true, token: await createSession(db, user.id, now), email: user.email }
}

export async function loginAccount(db: AuthD1, body: unknown): Promise<AuthOutcome> {
  const credentials = readCredentials(body)
  if (!credentials) return { ok: false, error: 'INVALID_REQUEST' }
  const user = await findUserByEmail(db, credentials.email)
  if (!user || !(await verifyPassword(credentials.password, user.password_hash))) return { ok: false, error: 'BAD_CREDENTIALS' }
  return { ok: true, token: await createSession(db, user.id, new Date().toISOString()), email: user.email }
}

export async function handleRegister(context: Context<{ Bindings: { DB?: AuthD1 } }>): Promise<Response> {
  const db = context.env?.DB
  if (!db) return context.json({ ok: false, error: 'ACCOUNTS_UNAVAILABLE' }, 503)
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400) }
  const outcome = await registerAccount(db, body)
  if (!outcome.ok) return context.json({ ok: false, error: outcome.error }, outcome.error === 'EMAIL_TAKEN' ? 409 : 400)
  return context.json({ ok: true, token: outcome.token, email: outcome.email })
}

export async function handleLogin(context: Context<{ Bindings: { DB?: AuthD1 } }>): Promise<Response> {
  const db = context.env?.DB
  if (!db) return context.json({ ok: false, error: 'ACCOUNTS_UNAVAILABLE' }, 503)
  let body: unknown
  try { body = await context.req.json() } catch { return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400) }
  const outcome = await loginAccount(db, body)
  if (!outcome.ok) return context.json({ ok: false, error: outcome.error }, outcome.error === 'INVALID_REQUEST' ? 400 : 401)
  return context.json({ ok: true, token: outcome.token, email: outcome.email })
}

export async function handleLogout(context: Context<{ Bindings: { DB?: AuthD1 } }>): Promise<Response> {
  const db = context.env?.DB
  if (!db) return context.json({ ok: true }, 200)
  const token = bearerToken(context.req.header('Authorization'))
  if (token) await deleteSession(db, token)
  return context.json({ ok: true })
}

export async function handleMe(context: Context<{ Bindings: { DB?: AuthD1 } }>): Promise<Response> {
  const db = context.env?.DB
  const token = bearerToken(context.req.header('Authorization'))
  if (!db || !token) return context.json({ ok: false, error: 'UNAUTHORIZED' }, 401)
  const user = await userForToken(db, token, new Date().toISOString())
  if (!user) return context.json({ ok: false, error: 'UNAUTHORIZED' }, 401)
  const planActive = (user.plan === 'monthly' || user.plan === 'yearly') && (!user.plan_expires_at || Date.parse(user.plan_expires_at) > Date.parse(new Date().toISOString()))
  return context.json({ ok: true, email: user.email, plan: planActive ? user.plan : 'free', planExpiresAt: user.plan_expires_at })
}
