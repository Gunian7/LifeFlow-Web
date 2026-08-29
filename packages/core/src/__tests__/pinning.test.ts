import { describe, expect, it } from 'vitest'
import { pinTask, unpinTask, type StoredTask } from '../index'

const base: StoredTask = { id: 'a', title: '组会', status: 'inbox', importance: 'important', targetDurationMinutes: 60, splittable: false, createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z', done: false }

describe('shared manual pin rules', () => {
  it('pins an estimated task at a local wall-clock time', () => {
    const result = pinTask(base, '15:00', '2026-08-29', 'Asia/Shanghai', '2026-08-29T04:00:00Z')
    expect(result.task).toMatchObject({ lockedStartAt: '2026-08-29T07:00:00.000Z', lockedEndAt: '2026-08-29T08:00:00.000Z' })
  })
  it('refuses to pin without an estimate', () => {
    const result = pinTask({ ...base, targetDurationMinutes: undefined }, '15:00', '2026-08-29', 'Asia/Shanghai', '2026-08-29T04:00:00Z')
    expect(result).toMatchObject({ issue: 'ESTIMATE_REQUIRED_TO_PIN' })
  })
  it('refuses a time already in the past', () => {
    expect(pinTask(base, '09:00', '2026-08-29', 'Asia/Shanghai', '2026-08-29T04:00:00Z')).toMatchObject({ issue: 'PIN_IN_THE_PAST' })
  })
  it('resolves 00:30 as the next day', () => {
    const result = pinTask(base, '00:30', '2026-08-29', 'Asia/Shanghai', '2026-08-29T04:00:00Z')
    expect(result.task?.lockedStartAt).toBe('2026-08-29T16:30:00.000Z')
  })
  it('unpinning clears both ends and preserves details', () => {
    const pinned = pinTask({ ...base, notes: '带资料' }, '15:00', '2026-08-29', 'Asia/Shanghai', '2026-08-29T04:00:00Z').task!
    const freed = unpinTask(pinned, '2026-08-29T05:00:00Z')
    expect(freed.lockedStartAt).toBeUndefined()
    expect(freed.lockedEndAt).toBeUndefined()
    expect(freed.notes).toBe('带资料')
  })
})
