import { describe, expect, it } from 'vitest'
import { planToday, replanToday, type PlannerInput, type PlannerTask } from '../index'

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

function input(tasks: PlannerTask[], preferredOrder?: string[]): PlannerInput {
  return { now: '2026-08-28T00:00:00.000Z', settings: baseSettings, tasks, fixedBlocks: [], preferredOrder }
}

describe('planner preferred order', () => {
  it('lets an adopted preference override the rule-based candidate order', () => {
    const result = planToday(input([task('must', 60, 'must'), task('want', 60, 'want')], ['want', 'must']))
    expect(result.planBlocks.map((block) => block.taskId)).toEqual(['want', 'must'])
  })

  it('sends unlisted tasks after the listed ones using the rule order', () => {
    const result = planToday(input([task('b', 60), task('a', 60), task('first', 60)], ['b']))
    expect(result.planBlocks.map((block) => block.taskId)).toEqual(['b', 'a', 'first'])
  })

  it('still protects the daily buffer when the preference wants more than fits', () => {
    const result = planToday(input([task('huge', 600, 'want')], ['huge']))
    expect(result.planBlocks).toHaveLength(0)
    expect(result.unscheduledTasks[0].reasonCodes).toContain('PRESERVED_BUFFER')
  })

  it('keeps an in-progress block ahead of the adopted order on replan', () => {
    const plannerInput = input([task('a', 60), task('b', 60)], ['b', 'a'])
    const replan = replanToday({
      ...plannerInput,
      existingBlocks: [{ taskId: 'a', startAt: '2026-08-28T00:00:00.000Z', endAt: '2026-08-28T01:00:00.000Z', source: 'automatic' }],
    })
    const aBlock = replan.planBlocks.find((block) => block.taskId === 'a')
    const bBlock = replan.planBlocks.find((block) => block.taskId === 'b')
    expect(aBlock?.startAt).toBe('2026-08-28T00:00:00.000Z')
    expect(Date.parse(bBlock!.startAt)).toBeGreaterThanOrEqual(Date.parse(aBlock!.endAt))
  })
})
