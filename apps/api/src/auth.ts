// Phase-2 accounts: email + PBKDF2 password hashing and random session
// tokens, all on WebCrypto so the Worker needs no external dependency.
// Sessions store only the SHA-256 of the token; the raw token lives in the
// user's browser.

const ITERATIONS = 100_000
const SESSION_DAYS = 30

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return EMAIL_RE.test(trimmed) && trimmed.length <= 254 ? trimmed : null
}

export function validPassword(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 8 && value.length <= 200 ? value : null
}

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256)
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  return `pbkdf2:${ITERATIONS}:${salt}:${await pbkdf2(password, salt)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split(':')
  if (scheme !== 'pbkdf2') return false
  return (await pbkdf2(password, salt)) === hash
}

export function newUserId(): string {
  return crypto.randomUUID()
}

export function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function sessionExpiry(now: string): string {
  return new Date(Date.parse(now) + SESSION_DAYS * 86400000).toISOString()
}

export function sessionValid(expiresAt: string, now: string): boolean {
  return Date.parse(expiresAt) > Date.parse(now)
}

// Passwords are hashed through PBKDF2 before ever touching the database.
export interface Credentials {
  email: string
  password: string
}

export function readCredentials(body: unknown): Credentials | null {
  if (!body || typeof body !== 'object') return null
  const value = body as { email?: unknown; password?: unknown }
  const email = validEmail(value.email)
  const password = validPassword(value.password)
  return email && password ? { email, password } : null
}
