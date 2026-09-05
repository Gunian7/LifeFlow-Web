// Phase-1 quota infrastructure: anonymous device identity + a daily call
// counter backed by D1. It is not strong authentication — it raises the bar
// from "open bar" to "one free daily allowance per device" until real
// accounts arrive in phase 2.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
  }
}

export function deviceIdFrom(headerValue: unknown): string | null {
  if (typeof headerValue !== 'string') return null
  const trimmed = headerValue.trim().toLowerCase()
  return UUID_RE.test(trimmed) ? trimmed : null
}

// Daily windows reset on UTC midnight for now; per-timezone reset arrives
// with real accounts in phase 2.
export function dayKey(now: string): string {
  return now.slice(0, 10)
}

export interface QuotaSnapshot {
  used: number
  limit: number
  remaining: number
  mode: 'enforced' | 'unconfigured'
}

export async function readQuota(db: D1Like | undefined, deviceId: string, day: string, limit: number): Promise<QuotaSnapshot> {
  if (!db) return { used: 0, limit, remaining: limit, mode: 'unconfigured' }
  const row = await db.prepare('SELECT count FROM ai_usage WHERE device_id = ?1 AND day = ?2').bind(deviceId, day).first<{ count: number }>()
  const used = row?.count ?? 0
  return { used, limit, remaining: Math.max(0, limit - used), mode: 'enforced' }
}

export async function recordUsage(db: D1Like | undefined, deviceId: string, day: string): Promise<void> {
  if (!db) return
  await db.prepare('INSERT INTO ai_usage (device_id, day, count) VALUES (?1, ?2, 1) ON CONFLICT (device_id, day) DO UPDATE SET count = count + 1').bind(deviceId, day).run()
}
