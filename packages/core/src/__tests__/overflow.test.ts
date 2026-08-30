import { describe, expect, it } from 'vitest'
import { planToday, type PlannerInput, type PlannerTask } from '../index'

const baseSettings = {
  timezone: 'Asia/Shanghai',
  planningDate: '2026-08-28',
  availabilityStartLocalTime: '08:00',
  availabilityEndLocalTime: '18:00',
  dailyBufferMinutes: 30,
  rest: { enabled: true, startLocalTime: '18:00', endLocalTime: '07:30' },
}

function task(id: string, minutes: number, extra: Partial<PlannerTask> = {}): PlannerTask {
  return { id, title: id, status: 'inbox', importance: 'important', targetDurationMinutes: minutes, splittable: false, ...extra }
}

function input(tasks: PlannerTask[], planningDate = '2026-08-28'): PlannerInput {
  return { now: `${planningDate}T00:00:00.000Z`, settings: { ...baseSettings, planningDate }, tasks, fixedBlocks: [] }
}

describe('overflow decisions', () => {
  it('keeps a deferred task out of today and schedules it the day it is due', () => {
    const deferred = task('tomorrow-thing', 60, { deferredUntil: '2026-08-29' })
    expect(planToday(input([deferred])).planBlocks).toHaveLength(0)
    expect(planToday(input([deferred])).unscheduledTasks).toHaveLength(0)
    const nextDay = planToday(input([deferred], '2026-08-29'))
    expect(nextDay.planBlocks).toHaveLength(1)
    expect(nextDay.planBlocks[0].taskId).toBe('tomorrow-thing')
  })

  it('forces a task that only fits when the buffer is released', () => {
    // 570 usable minutes; 580 needs the 30-minute buffer tail.
    const evening = task('evening', 580, { forceToday: true })
    const result = planToday(input([evening]))
    const block = result.planBlocks.find((candidate) => candidate.taskId === 'evening')
    expect(block).toBeDefined()
    expect(block!.reasonCodes).toContain('USER_FORCED_TODAY')
    expect(result.unscheduledTasks.some((item) => item.taskId === 'evening')).toBe(false)
  })

  it('extends into the rest window up to the next morning when that is the only space left', () => {
    // A deadline keeps the 560-minute task first; the 120-minute forced task
    // then only fits by consuming the rest window until the next morning.
    const big = task('big', 560, { deadlineAt: '2026-08-28T09:30:00.000Z' })
    const night = task('night', 120, { forceToday: true })
    const result = planToday(input([big, night]))
    const nightBlock = result.planBlocks.find((candidate) => candidate.taskId === 'night')
    expect(nightBlock).toBeDefined()
    expect(nightBlock!.reasonCodes).toContain('USER_FORCED_TODAY')
    expect(Date.parse(nightBlock!.endAt)).toBeLessThanOrEqual(Date.parse('2026-08-29T23:30:00.000Z'))
  })

  it('never lets a forced task run past the rest window end', () => {
    const huge = task('huge', 60 * 24, { forceToday: true, splittable: true, minimumDurationMinutes: 60 * 24, minChunkMinutes: 60 * 24 })
    const result = planToday(input([huge]))
    for (const block of result.planBlocks) {
      expect(Date.parse(block.endAt)).toBeLessThanOrEqual(Date.parse('2026-08-29T23:30:00.000Z'))
    }
  })
})
