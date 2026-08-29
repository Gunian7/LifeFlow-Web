export type FocusState = 'running' | 'paused'
export interface FocusSession {
  taskId: string
  startedAt: string
  durationMinutes: number
  state: FocusState
  elapsedSeconds?: number
  pausedAt?: string
}

const SECOND = 1000
export function startFocus(taskId: string, durationMinutes: number, now: string): FocusSession {
  return { taskId, startedAt: now, durationMinutes, state: 'running' }
}

export function focusRemainingSeconds(session: FocusSession, now: string): number {
  const elapsed = session.state === 'paused' ? (session.elapsedSeconds ?? 0) : Math.max(0, Math.floor((Date.parse(now) - Date.parse(session.startedAt)) / SECOND) + (session.elapsedSeconds ?? 0))
  return Math.max(0, session.durationMinutes * 60 - elapsed)
}

export function pauseFocus(session: FocusSession, now: string): FocusSession {
  if (session.state === 'paused') return session
  const elapsedSeconds = Math.min(session.durationMinutes * 60, Math.max(0, Math.floor((Date.parse(now) - Date.parse(session.startedAt)) / SECOND) + (session.elapsedSeconds ?? 0)))
  return { ...session, state: 'paused', pausedAt: now, elapsedSeconds }
}

export function resumeFocus(session: FocusSession, now: string): FocusSession {
  if (session.state === 'running') return session
  return { ...session, state: 'running', startedAt: now, pausedAt: undefined }
}

export function stopFocus(_session: FocusSession): undefined { return undefined }
