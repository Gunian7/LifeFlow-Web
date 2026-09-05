import type { Context } from 'hono'
import type { Plan } from './auth-routes'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 无易混淆字符

export interface GeneratedCode { code: string; plan: Plan; days: number }

// 兑换码原文只在这里出现一次：生成时返回给卖家，库中只存 SHA-256。
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const chars = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
  return `LF-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`
}

export async function codeDigest(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface RedeemRow { code_hash: string; plan: string; days: number; used_by: string | null; used_at: string | null }

export interface RedeemD1 {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      all<T>(): Promise<{ results?: T[] }>
      run(): Promise<unknown>
    }
  }
}

export async function storeCodes(db: RedeemD1, codes: GeneratedCode[]): Promise<void> {
  for (const code of codes) {
    await db.prepare('INSERT INTO redeem_codes (code_hash, plan, days) VALUES (?1, ?2, ?3)').bind(await codeDigest(code.code), code.plan, code.days).run()
  }
}

// 核销：原子地占用未使用的码，返回码的套餐信息；null = 码不存在或已被用。
export async function claimCode(db: RedeemD1, code: string, userId: string, now: string): Promise<{ plan: Plan; days: number } | null> {
  const hash = await codeDigest(code)
  return await db.prepare('UPDATE redeem_codes SET used_by = ?1, used_at = ?2 WHERE code_hash = ?3 AND used_by IS NULL RETURNING plan, days').bind(userId, now, hash).first<{ plan: Plan; days: number }>()
}

interface GenerateBindings {
  ADMIN_KEY?: string
  DB?: RedeemD1
}

export async function handleGenerateCodes(context: Context<{ Bindings: GenerateBindings }>): Promise<Response> {
  const adminKey = context.env?.ADMIN_KEY
  if (!adminKey || context.req.header('X-Admin-Key') !== adminKey) {
    return context.json({ ok: false, error: 'FORBIDDEN' }, 403)
  }
  const raw = await context.req.json().catch(() => null) as { plan?: unknown; days?: unknown; count?: unknown } | null
  const plan = raw?.plan
  const rawDays = raw?.days
  const rawCount = raw?.count
  if (plan !== 'monthly' && plan !== 'yearly') return context.json({ ok: false, error: 'INVALID_REQUEST' }, 400)
  const count = typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount > 0 && rawCount <= 50 ? rawCount : 1
  const days = typeof rawDays === 'number' && rawDays > 0 ? Math.min(3650, Math.floor(rawDays)) : 30
  const codes: GeneratedCode[] = Array.from({ length: count }, () => ({ code: generateCode(), plan, days }))
  if (context.env?.DB) await storeCodes(context.env.DB, codes)
  return context.json({ ok: true, codes })
}
