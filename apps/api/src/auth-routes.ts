import type { Context } from 'hono'
import type { D1Like } from './quota'
import { hashPassword, newSalt, newSessionToken, newUserId, readCredentials, sessionExpiry, sessionValid, tokenHash, verifyPassword } from './auth'

export interface UserRow { id: string; email: string; password_hash: string; created_at: string }
export interface SessionRow { token_hash: string; user_id: string; expires_at: string }

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
  return await db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?1').bind(email).first<UserRow>()
}

export async function createUser(db: AuthD1, email: string, password: string, now: string): Promise<UserRow> {
  const user: UserRow = { id: newUserId(), email, password_hash: await hashPassword(password, newSalt()), created_at: now }
  await db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)').bind(user.id, user.email, user.password_hash, user.created_at).run()
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
  return await db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE id = ?1').bind(session.user_id).first<UserRow>()
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
  return context.json({ ok: true, email: user.email })
}
