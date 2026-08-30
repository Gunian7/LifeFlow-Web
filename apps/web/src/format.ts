// Shared formatting helpers for the web app.

// The local calendar date (YYYY-MM-DD). toISOString().slice(0, 10) would give
// the UTC date, which lags a day for every early-morning hour east of UTC.
export function localDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function pad2(value: number): string { return String(value).padStart(2, '0') }

// ISO instant -> value for <input type="datetime-local"> in the local zone.
export function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function reasonText(codes: string[]): string {
  if (codes.includes('ESTIMATE_REQUIRED')) return '还没估时间'
  if (codes.includes('PRESERVED_BUFFER')) return '需要动用缓冲'
  if (codes.includes('REST_PROTECTION')) return '会占用休息时间'
  if (codes.includes('DEADLINE_URGENT')) return '截止时间很近'
  return '今天时间不够'
}
