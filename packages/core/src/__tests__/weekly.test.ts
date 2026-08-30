import { describe, expect, it } from 'vitest'
import { completedThisWeek, weekKey } from '../weekly'
import type { StoredTask } from '../index'

function task(id: string, completedAt: string): StoredTask {
  return { id, title: id, status: 'completed', importance: 'important', splittable: false, createdAt: completedAt, updatedAt: completedAt, completedAt, done: true }
}

describe('weekly review', () => {
  it('gives the same key to every day of one Monday-Sunday week', () => {
    expect(weekKey('2026-08-24T06:00:00.000Z')).toBe(weekKey('2026-08-30T06:00:00.000Z'))
  })

  it('moves to a new key when the week turns over', () => {
    expect(weekKey('2026-08-30T06:00:00.000Z')).not.toBe(weekKey('2026-08-31T06:00:00.000Z'))
  })

  it('counts completions inside the current week and dedupes by title', () => {
    const tasks = [
      task('a', '2026-08-25T02:00:00.000Z'),
      task('a-again', '2026-08-26T02:00:00.000Z'),
      task('a-again', '2026-08-27T02:00:00.000Z'),
      task('old', '2026-08-20T02:00:00.000Z'),
    ]
    const items = completedThisWeek(tasks, '2026-08-28T12:00:00.000Z')
    expect(items).toEqual([{ title: 'a', count: 1 }, { title: 'a-again', count: 2 }])
  })

  it('ignores open tasks', () => {
    const open: StoredTask = { id: 'open', title: 'open', status: 'inbox', importance: 'want', splittable: false, createdAt: '2026-08-25T02:00:00.000Z', updatedAt: '2026-08-25T02:00:00.000Z', done: false }
    expect(completedThisWeek([open], '2026-08-28T12:00:00.000Z')).toHaveLength(0)
  })
})
