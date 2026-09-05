import { describe, expect, it } from 'vitest'
import { buildBriefingFacts } from '../briefing'
import type { StoredTask } from '../index'

const settings = {
  timezone: 'Asia/Shanghai',
  planningDate: '2026-08-28',
  availabilityStartLocalTime: '08:00',
  availabilityEndLocalTime: '23:30',
  dailyBufferMinutes: 45,
  rest: { enabled: true, startLocalTime: '23:30', endLocalTime: '07:30' },
}

function task(id: string, importance: StoredTask['importance'] = 'important'): StoredTask {
  return { id, title: id, status: 'inbox', importance, targetDurationMinutes: 30, splittable: false, createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', done: false }
}

const blocks = [
  { taskId: 'first', startAt: '2026-08-28T00:00:00.000Z', endAt: '2026-08-28T00:30:00.000Z' },
  { taskId: 'must', startAt: '2026-08-28T00:30:00.000Z', endAt: '2026-08-28T01:00:00.000Z' },
]

describe('briefing facts', () => {
  it('counts scheduled tasks and must tasks honestly', () => {
    const facts = buildBriefingFacts({ tasks: [task('first'), task('must', 'must')], planBlocks: blocks, unscheduledCount: 1, deferredCount: 2, carriedCount: 0, settings, now: '2026-08-27T20:00:00.000Z' })
    expect(facts).toMatchObject({ date: '2026-08-28', taskCount: 2, mustCount: 1, unscheduledCount: 1, deferredCount: 2, firstTask: { title: 'first', startLocal: '08:00' } })
    expect(facts.restWindow).toEqual({ start: '23:30', end: '07:30' })
  })

  it('skips done tasks and reports no first task when the plan is empty', () => {
    const done = { ...task('gone'), done: true, status: 'completed' as const, completedAt: '2026-08-28T01:00:00.000Z' }
    const facts = buildBriefingFacts({ tasks: [done], planBlocks: [{ taskId: 'gone', startAt: '2026-08-28T00:00:00.000Z', endAt: '2026-08-28T00:30:00.000Z' }], unscheduledCount: 0, deferredCount: 0, carriedCount: 3, settings, now: '2026-08-28T02:00:00.000Z' })
    expect(facts.taskCount).toBe(0)
    expect(facts.mustCount).toBe(0)
    expect(facts.firstTask).toBeUndefined()
    expect(facts.carriedCount).toBe(3)
  })
})
