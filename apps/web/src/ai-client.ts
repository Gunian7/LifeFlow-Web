import { deviceID } from './device'
import { savedToken } from './account'

export class AiQuotaError extends Error {
  constructor() { super('今日 AI 额度已用完') }
}

// Shared client for the AI gateway: tags every call with the device id so
// the server can count daily usage, attaches the account token when logged
// in (quota follows the account), and translates a 429 into a typed error
// the UI can render as a friendly message.
export async function aiPost<T>(apiBaseUrl: string, path: string, payload: unknown): Promise<T> {
  const token = savedToken()
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LifeFlow-Device': deviceID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
  if (response.status === 429) throw new AiQuotaError()
  if (!response.ok) throw new Error('AI_UNAVAILABLE')
  return await response.json() as T
}

export interface QuotaSnapshot { used: number; limit: number; remaining: number; mode: string }

export async function aiQuota(apiBaseUrl: string): Promise<QuotaSnapshot> {
  const token = savedToken()
  const response = await fetch(`${apiBaseUrl}/v1/ai/quota`, { headers: { 'X-LifeFlow-Device': deviceID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (!response.ok) throw new Error('AI_UNAVAILABLE')
  return await response.json() as QuotaSnapshot
}
