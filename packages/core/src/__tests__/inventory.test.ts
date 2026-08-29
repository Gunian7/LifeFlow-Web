import { describe, expect, it } from 'vitest'
import { inventory, type StoredTask } from '../index'

const base = (id: string, status: StoredTask['status'], minutes?: number): StoredTask => ({
  id, title: id, status, importance: 'important', targetDurationMinutes: minutes, splittable: false,
  done: status === 'completed', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z',
})

describe('task inventory', () => {
  it('groups every non-cancelled task without losing unestimated work', () => {
    const result = inventory([base('today', 'planned', 30), base('waiting', 'inbox', 30), base('vague', 'inbox'), base('done', 'completed')], ['today'])
    expect(result.map((group) => group.key)).toEqual(['today', 'waiting', 'needsEstimate', 'completed'])
  })
  it('hides cancelled tasks but keeps completed tasks visible', () => {
    const result = inventory([base('cancelled', 'cancelled', 30), base('done', 'completed', 30)], [])
    expect(result).toMatchObject([{ key: 'completed', items: [{ taskId: 'done' }] }])
  })
  it('marks recurring and pinned metadata for the UI', () => {
    const item = base('repeat', 'inbox', 30)
    item.templateId = 'template-1'; item.lockedStartAt = '2026-08-29T07:00:00Z'
    const result = inventory([item], [])
    expect(result[0].items[0]).toMatchObject({ recurring: true, pinned: true })
  })
})
