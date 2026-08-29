import { describe, expect, it } from 'vitest'
import { planToday, replanToday, type ExistingPlanBlock, type PlannerInput, type PlannerTask } from '../index'

const settings = {
  timezone: 'Asia/Shanghai', planningDate: '2026-08-28', availabilityStartLocalTime: '08:00', availabilityEndLocalTime: '23:30', dailyBufferMinutes: 45,
  rest: { enabled: true, startLocalTime: '23:30', endLocalTime: '07:30' },
}
const task = (id: string, extra: Partial<PlannerTask> = {}): PlannerTask => ({ id, title: id, status: 'inbox', importance: 'important', targetDurationMinutes: 30, splittable: false, ...extra })
const input = (tasks: PlannerTask[], existingBlocks: ExistingPlanBlock[]): PlannerInput & { existingBlocks: ExistingPlanBlock[] } => ({ now: '2026-08-28T04:00:00.000Z', settings, tasks, fixedBlocks: [], existingBlocks })

describe('task locks are facts during replanning', () => {
  it('honors a task lock even when there is no previous plan snapshot', () => {
    const result = replanToday(input([task('pinned', { lockedStartAt: '2026-08-28T08:00:00.000Z', lockedEndAt: '2026-08-28T08:30:00.000Z' })], []))
    expect(result.planBlocks[0]).toMatchObject({ taskId: 'pinned', startAt: '2026-08-28T08:00:00.000Z', source: 'manualLock' })
  })

  it('keeps a task lock out of automatic placement twice', () => {
    const pinned = task('pinned', { lockedStartAt: '2026-08-28T08:00:00.000Z', lockedEndAt: '2026-08-28T08:30:00.000Z' })
    const result = replanToday(input([pinned], []))
    expect(result.planBlocks.filter((block) => block.taskId === 'pinned')).toHaveLength(1)
  })
})
