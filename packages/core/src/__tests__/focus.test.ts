import { describe, expect, it } from 'vitest'
import { startFocus, pauseFocus, resumeFocus, stopFocus, focusRemainingSeconds, type FocusSession } from '../focus'

const started: FocusSession = { taskId: 'report', startedAt: '2026-08-29T10:00:00.000Z', durationMinutes: 30, state: 'running' }

describe('focus session', () => {
  it('starts a session for one task without completing it', () => {
    expect(startFocus('report', 30, '2026-08-29T10:00:00.000Z')).toEqual(started)
  })

  it('calculates remaining time from an injected clock', () => {
    expect(focusRemainingSeconds(started, '2026-08-29T10:12:15.000Z')).toBe(1065)
  })

  it('pauses without losing elapsed time', () => {
    const paused = pauseFocus(started, '2026-08-29T10:12:15.000Z')
    expect(paused).toMatchObject({ state: 'paused', pausedAt: '2026-08-29T10:12:15.000Z', elapsedSeconds: 735 })
  })

  it('resumes from the paused elapsed time', () => {
    const paused = pauseFocus(started, '2026-08-29T10:12:15.000Z')
    expect(resumeFocus(paused, '2026-08-29T11:00:00.000Z')).toMatchObject({ state: 'running', startedAt: '2026-08-29T11:00:00.000Z', elapsedSeconds: 735 })
  })

  it('stops a session without changing task completion', () => {
    expect(stopFocus(started)).toBeUndefined()
  })

  it('returns zero after the session duration, never negative', () => {
    expect(focusRemainingSeconds(started, '2026-08-29T11:00:00.000Z')).toBe(0)
  })
})
