import { describe, expect, it } from 'vitest'
import { planToday, type PlannerInput, type PlannerTask } from '../index'

const settings = {
  timezone: 'Asia/Shanghai', planningDate: '2026-08-28',
  availabilityStartLocalTime: '08:00', availabilityEndLocalTime: '23:30',
  dailyBufferMinutes: 45,
  rest: { enabled: true, startLocalTime: '23:30', endLocalTime: '07:30' },
}
function task(id: string, minutes: number, extra: Partial<PlannerTask> = {}): PlannerTask {
  return { id, title: id, status: 'inbox', importance: 'important', targetDurationMinutes: minutes, splittable: false, ...extra }
}
function input(tasks: PlannerTask[]): PlannerInput { return { now: '2026-08-28T00:00:00.000Z', settings, tasks, fixedBlocks: [] } }

describe('shared planner rules', () => {
  it('keeps the daily buffer at the end', () => {
    const result = planToday(input([task('fill', 885, { importance: 'must' })]))
    expect(result.planBlocks[0].endAt).toBe('2026-08-28T14:45:00.000Z')
    expect(result.feasibility).toBe('feasible')
  })

  it('splits a splittable task across fragmented slots', () => {
    const plannerInput = input([task('study', 120, { splittable: true, minimumDurationMinutes: 60, minChunkMinutes: 30 })])
    plannerInput.fixedBlocks = [{ id: 'break', title: 'break', startAt: '2026-08-28T01:00:00.000Z', endAt: '2026-08-28T02:00:00.000Z', strength: 'hard', movable: false }]
    const result = planToday(plannerInput)
    expect(result.planBlocks).toHaveLength(2)
    expect(result.planBlocks.every((block) => Date.parse(block.endAt) - Date.parse(block.startAt) >= 30 * 60_000)).toBe(true)
    expect(result.planBlocks.every((block) => block.reasonCodes.includes('SPLIT_TO_FIT'))).toBe(true)
  })

  it('rolls back a partial split below the minimum', () => {
    const plannerInput = input([task('study', 120, { importance: 'must', splittable: true, minimumDurationMinutes: 60, minChunkMinutes: 30 })])
    plannerInput.fixedBlocks = [{ id: 'day', title: 'day', startAt: '2026-08-28T00:45:00.000Z', endAt: '2026-08-28T15:30:00.000Z', strength: 'hard', movable: false }]
    const result = planToday(plannerInput)
    expect(result.planBlocks).toHaveLength(0)
    expect(result.unscheduledTasks[0].reasonCodes).toContain('INSUFFICIENT_TIME')
    expect(result.feasibility).toBe('infeasible')
  })

  it('never schedules past a deadline', () => {
    const result = planToday(input([task('due', 90, { importance: 'must', deadlineAt: '2026-08-28T01:00:00.000Z' })]))
    expect(result.planBlocks).toHaveLength(0)
    expect(result.feasibility).toBe('infeasible')
  })

  it('orders earlier deadlines first and marks urgent ones', () => {
    const result = planToday(input([
      task('later', 30, { deadlineAt: '2026-08-28T06:00:00.000Z' }),
      task('urgent', 30, { deadlineAt: '2026-08-28T01:30:00.000Z' }),
    ]))
    expect(result.planBlocks[0].taskId).toBe('urgent')
    expect(result.planBlocks[0].reasonCodes).toContain('DEADLINE_TODAY')
    expect(result.planBlocks[0].reasonCodes).toContain('DEADLINE_URGENT')
  })

  it('protects the overnight rest window', () => {
    const plannerInput = input([task('night', 60, { importance: 'must' })])
    plannerInput.settings.availabilityStartLocalTime = '23:00'
    plannerInput.settings.availabilityEndLocalTime = '01:00'
    const result = planToday(plannerInput)
    expect(result.planBlocks).toHaveLength(0)
    expect(result.unscheduledTasks[0].reasonCodes).toContain('REST_PROTECTION')
  })
})
