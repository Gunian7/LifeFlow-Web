import { describe, expect, it } from 'vitest'
import app from './index'
import { tokenHash } from './auth'
import type { AuthD1 } from './auth-routes'

const EMAIL = 'user@example.com'
const PASSWORD = 'hunter2hunter2'

// In-memory D1 fake covering the users/sessions/ai_usage statements.
function fakeD1(): AuthD1 & { users: Map<string, { email: string; passwordHash: string; id: string }>; sessions: Map<string, { userId: string; expiresAt: string }> } {
  const users = new Map<string, { id: string; email: string; passwordHash: string }>()
  const sessions = new Map<string, { userId: string; expiresAt: string }>()
  const emailIndex = new Map<string, string>()
  return {
    users,
    sessions,
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (query.includes('FROM users WHERE email')) {
                const id = emailIndex.get(values[0] as string)
                const user = id ? users.get(id) : undefined
                return user ? { id: user.id, email: user.email, password_hash: user.passwordHash, created_at: '' } as T : null
              }
              if (query.includes('FROM users WHERE id')) {
                const user = users.get(values[0] as string)
                return user ? { id: user.id, email: user.email, password_hash: user.passwordHash, created_at: '' } as T : null
              }
              if (query.includes('FROM sessions WHERE token_hash')) {
                const session = sessions.get(values[0] as string)
                return session ? { token_hash: values[0] as string, user_id: session.userId, expires_at: session.expiresAt } as T : null
              }
              return null
            },
            async all<T>(): Promise<{ results?: T[] }> {
              return { results: [] }
            },
            async run(): Promise<unknown> {
              if (query.includes('INSERT INTO users')) {
                const [id, email, passwordHash, createdAt] = values as [string, string, string, string]
                users.set(id, { id, email, passwordHash })
                emailIndex.set(email, id)
              }
              if (query.includes('INSERT INTO sessions')) {
                const [tokenHashValue, userId, expiresAt] = values as [string, string, string]
                sessions.set(tokenHashValue, { userId, expiresAt })
              }
              if (query.includes('DELETE FROM sessions')) sessions.delete(values[0] as string)
              return null
            },
          }
        },
      }
    },
  }
}

async function register(email = EMAIL, password = PASSWORD): Promise<string> {
  const response = await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }, { DB: fakeD1() })
  const data = await response.json() as { token?: string }
  return data.token ?? ''
}

describe('auth accounts', () => {
  it('registers, logs in, and returns the account from /me', async () => {
    const db = fakeD1()
    const env = { DB: db }
    const registerResponse = await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }, env)
    expect(registerResponse.status).toBe(200)
    const { token, email } = await registerResponse.json() as { token: string; email: string }
    expect(email).toBe(EMAIL)
    const me = await app.request('http://localhost/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ ok: true, email: EMAIL })
    // 会话令牌只存哈希：数据库里查不到原文
    const hashes = [...db.sessions.keys()]
    expect(hashes).toHaveLength(1)
    expect(hashes[0]).toBe(await tokenHash(token))
  })

  it('rejects duplicate email and wrong password', async () => {
    const db = fakeD1()
    const env = { DB: db }
    await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }, env)
    const duplicate = await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL.toUpperCase(), password: PASSWORD }) }, env)
    expect(duplicate.status).toBe(409)
    const badLogin = await app.request('http://localhost/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'wrong-password' }) }, env)
    expect(badLogin.status).toBe(401)
  })

  it('rejects weak credentials at the door', async () => {
    const env = { DB: fakeD1() }
    const short = await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: '短' }) }, env)
    expect(short.status).toBe(400)
    const badEmail = await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: '不是邮箱', password: PASSWORD }) }, env)
    expect(badEmail.status).toBe(400)
  })

  it('logs out by revoking the session', async () => {
    const db = fakeD1()
    const env = { DB: db }
    const token = await register('logout@example.com', PASSWORD)
    const logout = await app.request('http://localhost/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env)
    expect(logout.status).toBe(200)
    const me = await app.request('http://localhost/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(me.status).toBe(401)
  })
})

describe('login flow', () => {
  it('logs in with the right password and issues a working session', async () => {
    const db = fakeD1()
    const env = { DB: db }
    await app.request('http://localhost/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }, env)
    const login = await app.request('http://localhost/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }, env)
    expect(login.status).toBe(200)
    const { token } = await login.json() as { token: string }
    const me = await app.request('http://localhost/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }, env)
    expect(me.status).toBe(200)
  })
})
