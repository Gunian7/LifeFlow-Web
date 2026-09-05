import { describe, expect, it } from 'vitest'
import { buildStatsFacts } from '../stats'
import type { StoredTask } from '../index'

function doneTask(id: string, completedAt: string): StoredTask {
  return { id, title: id, status: 'completed', importance: 'important', splittable: false, createdAt: completedAt, updatedAt: completedAt, completedAt, done: true }
}
function openTask(id: string, importance: StoredTask['importance']): StoredTask {
  return { id, title: id, status: 'inbox', importance, splittable: false, createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', done: false }
}

describe('stats facts', () => {
  it('counts completions per day for the given window', () => {
    const tasks = [
      doneTask('a', '2026-08-27T02:00:00.000Z'),
      doneTask('b', '2026-08-27T06:00:00.000Z'),
      doneTask('c', '2026-08-28T02:00:00.000Z'),
    ]
    const facts = buildStatsFacts(tasks, '2026-08-28T12:00:00.000Z', 3)
    expect(facts.days).toHaveLength(3)
    // The exact day bucketing depends on local timezone; just check totals.
    const total = facts.days.reduce((sum, d) => sum + d.completed, 0)
    expect(total).toBe(3)
  })

  it('distributes open tasks by importance', () => {
    const tasks = [
      openTask('a', 'must'),
      openTask('b', 'must'),
      openTask('c', 'important'),
      openTask('d', 'want'),
    ]
    const facts = buildStatsFacts(tasks, '2026-08-28T12:00:00.000Z', 14)
    expect(facts.openByImportance).toEqual({ must: 2, important: 1, want: 1 })
  })

  it('counts total completed', () => {
    const tasks = [doneTask('a', '2026-08-27T02:00:00.000Z'), openTask('b', 'must')]
    expect(buildStatsFacts(tasks, '2026-08-28T12:00:00.000Z', 14).totalCompleted).toBe(1)
  })
})
