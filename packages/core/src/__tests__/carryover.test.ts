import { describe, expect, it } from 'vitest'
import { selectCarryoverTasks } from '../carryover'
import type { StoredTask } from '../index'

function task(id: string, extra: Partial<StoredTask> = {}): StoredTask {
  return { id, title: id, status: 'inbox', importance: 'important', splittable: false, createdAt: '2026-08-27T08:00:00.000Z', updatedAt: '2026-08-27T08:00:00.000Z', done: false, ...extra }
}

describe('carryover selection', () => {
  it('picks open tasks last touched before today', () => {
    const items = selectCarryoverTasks([task('a'), task('b', { updatedAt: '2026-08-28T09:00:00.000Z' })], '2026-08-28')
    expect(items.map((item) => item.taskId)).toEqual(['a'])
  })

  it('never asks about finished, recurring or already-released tasks', () => {
    const items = selectCarryoverTasks([
      task('done', { done: true, status: 'completed' }),
      task('recurring', { templateId: 't-1', occurrenceDate: '2026-08-27' }),
      task('skipped', { status: 'skipped' }),
      task('cancelled', { status: 'cancelled' }),
    ], '2026-08-28')
    expect(items).toHaveLength(0)
  })

  it('carries the duration so the morning card can show it', () => {
    const items = selectCarryoverTasks([task('a', { targetDurationMinutes: 45 })], '2026-08-28')
    expect(items[0]).toEqual({ taskId: 'a', title: 'a', minutes: 45 })
  })
})
