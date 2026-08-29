import { describe, expect, it } from 'vitest'
import { planToday, type PlannerInput, type PlannerTask } from '../index'

const baseSettings = {
  timezone: 'Asia/Shanghai',
  planningDate: '2026-08-28',
  availabilityStartLocalTime: '08:00',
  availabilityEndLocalTime: '18:00',
  dailyBufferMinutes: 30,
  rest: { enabled: false, startLocalTime: '23:30', endLocalTime: '07:30' },
}

function task(id: string, minutes: number, importance: PlannerTask['importance'] = 'important'): PlannerTask {
  return { id, title: id, status: 'inbox', importance, targetDurationMinutes: minutes, splittable: false }
}

function input(tasks: PlannerTask[]): PlannerInput {
  return { now: '2026-08-28T00:00:00.000Z', settings: baseSettings, tasks, fixedBlocks: [] }
}

describe('shared planner core', () => {
  it('places a task at the beginning of the remaining window', () => {
    const result = planToday(input([task('write', 60)]))
    expect(result.planBlocks).toHaveLength(1)
    expect(result.planBlocks[0]).toMatchObject({
      taskId: 'write',
      startAt: '2026-08-28T00:00:00.000Z',
      endAt: '2026-08-28T01:00:00.000Z',
    })
  })

  it('keeps a hard fixed block out of the task slot', () => {
    const plannerInput = input([task('write', 60)])
    plannerInput.fixedBlocks = [{
      id: 'meeting', title: 'meeting',
      startAt: '2026-08-28T00:00:00.000Z', endAt: '2026-08-28T01:00:00.000Z',
      strength: 'hard', movable: false,
    }]

    const result = planToday(plannerInput)
    expect(result.planBlocks[0].startAt).toBe('2026-08-28T01:00:00.000Z')
  })

  it('holds the daily buffer and reports an unscheduled task honestly', () => {
    const result = planToday(input([task('too-long', 600, 'must')]))
    expect(result.planBlocks).toHaveLength(0)
    expect(result.unscheduledTasks[0]).toMatchObject({ taskId: 'too-long', reasonCodes: ['INSUFFICIENT_TIME'] })
    expect(result.feasibility).toBe('infeasible')
  })

  it('uses must importance before important regardless of input order', () => {
    const result = planToday(input([task('normal', 60), task('must', 60, 'must')]))
    expect(result.planBlocks[0].taskId).toBe('must')
  })

  it('is deterministic for identical input', () => {
    const plannerInput = input([task('a', 30), task('b', 45)])
    expect(planToday(plannerInput)).toEqual(planToday(plannerInput))
  })
})
