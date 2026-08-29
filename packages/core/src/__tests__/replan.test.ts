import { describe, expect, it } from 'vitest'
import { planToday, replanToday, type ExistingPlanBlock, type PlannerInput, type PlannerTask } from '../index'

const settings = {
  timezone: 'Asia/Shanghai', planningDate: '2026-08-28',
  availabilityStartLocalTime: '08:00', availabilityEndLocalTime: '23:30', dailyBufferMinutes: 45,
  rest: { enabled: true, startLocalTime: '23:30', endLocalTime: '07:30' },
}
function task(id: string, minutes: number, extra: Partial<PlannerTask> = {}): PlannerTask {
  return { id, title: id, status: 'inbox', importance: 'important', targetDurationMinutes: minutes, splittable: false, ...extra }
}
function previous(taskId: string, startAt: string, endAt: string, source: ExistingPlanBlock['source'] = 'automatic'): ExistingPlanBlock {
  return { taskId, startAt, endAt, source }
}
function input(tasks: PlannerTask[], existingBlocks: ExistingPlanBlock[]): PlannerInput & { existingBlocks: ExistingPlanBlock[] } {
  return { now: '2026-08-28T04:00:00.000Z', settings, tasks, fixedBlocks: [], existingBlocks }
}

describe('shared ReplanToday rules', () => {
  it('keeps a currently running block exactly where it is', () => {
    const result = replanToday(input(
      [task('running', 60), task('new', 60)],
      [previous('running', '2026-08-28T03:30:00.000Z', '2026-08-28T04:30:00.000Z')],
    ))
    const running = result.planBlocks.find((block) => block.taskId === 'running')!
    expect(running.startAt).toBe('2026-08-28T03:30:00.000Z')
    expect(running.reasonCodes).toContain('IN_PROGRESS_PROTECTED')
  })

  it('keeps a manually locked block exactly where it is', () => {
    const result = replanToday(input(
      [task('pinned', 60), task('new', 60)],
      [previous('pinned', '2026-08-28T08:00:00.000Z', '2026-08-28T09:00:00.000Z', 'manualLock')],
    ))
    const pinned = result.planBlocks.find((block) => block.taskId === 'pinned')!
    expect(pinned.source).toBe('manualLock')
    expect(pinned.reasonCodes).toContain('MANUALLY_LOCKED')
  })

  it('allows a not-yet-started automatic block to move', () => {
    const urgent = task('urgent', 60, { importance: 'must', deadlineAt: '2026-08-28T06:00:00.000Z' })
    const result = replanToday(input(
      [task('later', 60), urgent],
      [previous('later', '2026-08-28T06:00:00.000Z', '2026-08-28T07:00:00.000Z')],
    ))
    expect(result.planBlocks[0].taskId).toBe('urgent')
    expect(result.changes.find((change) => change.taskId === 'later')?.kind).toBe('MOVED')
  })

  it('reports a newly added task as ADDED', () => {
    const result = replanToday(input([task('new', 30)], []))
    expect(result.changes).toContainEqual({ taskId: 'new', kind: 'ADDED', newStartAt: '2026-08-28T04:00:00.000Z' })
  })

  it('does not report unchanged blocks as noise', () => {
    const firstInput = input([task('steady', 30)], [])
    const first = replanToday(firstInput)
    const block = first.planBlocks[0]
    const second = replanToday(input([task('steady', 30)], [previous('steady', block.startAt, block.endAt)]))
    expect(second.changes).toEqual([])
  })

  it('keeps stale unfinished blocks visible but does not reschedule them', () => {
    const result = replanToday(input(
      [task('missed', 30), task('future', 30)],
      [previous('missed', '2026-08-28T01:00:00.000Z', '2026-08-28T01:30:00.000Z')],
    ))
    expect(result.stalePlanBlocks).toHaveLength(1)
    expect(result.stalePlanBlocks[0].taskId).toBe('missed')
    expect(result.planBlocks.some((block) => block.taskId === 'missed')).toBe(false)
    expect(result.unscheduledTasks.some((item) => item.taskId === 'missed')).toBe(false)
    expect(result.planBlocks.find((block) => block.taskId === 'future')).toBeDefined()
  })

  it('does not stale a block whose task is already completed', () => {
    const done = task('done', 30, { status: 'completed' })
    const result = replanToday(input([done], [previous('done', '2026-08-28T01:00:00.000Z', '2026-08-28T01:30:00.000Z')]))
    expect(result.stalePlanBlocks).toEqual([])
  })

  it('returns chronological blocks even when protected blocks are merged first', () => {
    const result = replanToday(input(
      [task('running', 30), task('later', 30)],
      [previous('running', '2026-08-28T05:00:00.000Z', '2026-08-28T05:30:00.000Z')],
    ))
    expect(Date.parse(result.planBlocks[0].startAt)).toBeLessThanOrEqual(Date.parse(result.planBlocks[1].startAt))
  })

  it('matches PlanToday when existingBlocks is empty', () => {
    const tasks = [task('a', 30), task('b', 45)]
    const replan = replanToday(input(tasks, []))
    const plain: PlannerInput = { now: '2026-08-28T04:00:00.000Z', settings, tasks, fixedBlocks: [] }
    const direct = planToday(plain)
    expect(replan.planBlocks).toEqual(direct.planBlocks)
    expect(replan.feasibility).toBe(direct.feasibility)
  })

  it('sorts changes by task id for deterministic explanations', () => {
    const result = replanToday(input([task('z', 30), task('a', 30), task('m', 30)], []))
    expect(result.changes.map((change) => change.taskId)).toEqual(['a', 'm', 'z'])
  })

  it('does not overlap a new automatic block with an in-progress block', () => {
    const result = replanToday(input(
      [task('running', 30), task('new', 120)],
      [previous('running', '2026-08-28T03:30:00.000Z', '2026-08-28T04:30:00.000Z')],
    ))
    const running = result.planBlocks.find((block) => block.taskId === 'running')!
    const runningStart = Date.parse(running.startAt)
    const runningEnd = Date.parse(running.endAt)
    for (const block of result.planBlocks.filter((item) => item.taskId !== 'running')) {
      expect(Date.parse(block.startAt) < runningEnd && Date.parse(block.endAt) > runningStart).toBe(false)
    }
  })
})
