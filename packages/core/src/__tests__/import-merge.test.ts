import { describe, expect, it } from 'vitest'
import { mergeImportedTasks, type StoredTask } from '../index'

const task = (id: string, updatedAt: string, title = id): StoredTask => ({
  id, title, status: 'inbox', importance: 'important', targetDurationMinutes: 30,
  splittable: false, done: false, createdAt: '2026-08-29T00:00:00.000Z', updatedAt,
})

describe('import merge', () => {
  it('adds imported tasks not already on this device', () => {
    const result = mergeImportedTasks([task('local', '2026-08-29T01:00:00.000Z')], [task('imported', '2026-08-29T01:00:00.000Z')])
    expect(result.tasks.map((item) => item.id)).toEqual(['imported', 'local'])
    expect(result).toMatchObject({ added: 1, replaced: 0, keptLocal: 0 })
  })

  it('keeps the newer local task instead of silently overwriting it', () => {
    const result = mergeImportedTasks([task('same', '2026-08-29T03:00:00.000Z', '本机新版')], [task('same', '2026-08-29T01:00:00.000Z', '导入旧版')])
    expect(result.tasks).toMatchObject([{ id: 'same', title: '本机新版' }])
    expect(result).toMatchObject({ added: 0, replaced: 0, keptLocal: 1 })
  })

  it('takes a newer imported task so export can restore later changes', () => {
    const result = mergeImportedTasks([task('same', '2026-08-29T01:00:00.000Z', '本机旧版')], [task('same', '2026-08-29T03:00:00.000Z', '导入新版')])
    expect(result.tasks).toMatchObject([{ id: 'same', title: '导入新版' }])
    expect(result).toMatchObject({ added: 0, replaced: 1, keptLocal: 0 })
  })

  it('does not duplicate identical task IDs', () => {
    const result = mergeImportedTasks([task('same', '2026-08-29T01:00:00.000Z')], [task('same', '2026-08-29T01:00:00.000Z')])
    expect(result.tasks).toHaveLength(1)
    expect(result).toMatchObject({ added: 0, replaced: 0, keptLocal: 1 })
  })
})
