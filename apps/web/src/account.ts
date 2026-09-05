// Client-side account session: token + email live in localStorage, sent as
// Bearer on AI calls so the server counts quota against the account.
const TOKEN_KEY = 'lifeflow-auth-token-v1'
const EMAIL_KEY = 'lifeflow-auth-email-v1'

export function savedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function savedEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY)
}

export function saveAccount(token: string, email: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(EMAIL_KEY, email)
}

export function clearAccount(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EMAIL_KEY)
}

export interface AccountResult { ok: boolean; token?: string; email?: string; error?: string }

export async function registerAccount(apiBaseUrl: string, email: string, password: string): Promise<AccountResult> {
  return await aiAuthPost(apiBaseUrl, '/v1/auth/register', { email, password })
}

export async function loginAccount(apiBaseUrl: string, email: string, password: string): Promise<AccountResult> {
  return await aiAuthPost(apiBaseUrl, '/v1/auth/login', { email, password })
}

export function logoutAccount(apiBaseUrl: string): void {
  const token = savedToken()
  clearAccount()
  if (token) void fetch(`${apiBaseUrl}/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
}

async function aiAuthPost(apiBaseUrl: string, path: string, payload: unknown): Promise<AccountResult> {
  const response = await fetch(`${apiBaseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const result = await response.json().catch(() => ({})) as AccountResult
  if (!response.ok || !result.ok || !result.token) {
    const error = new Error(result.error ?? 'FAILED') as Error & { code?: string; status?: number }
    error.code = result.error
    error.status = response.status
    throw error
  }
  return result
}
