import { describe, expect, it } from 'vitest'
import { buildExport, parseImport, type StoredTask } from '../index'

const task: StoredTask = {
  id: 'a', title: '写报告', status: 'inbox', importance: 'important',
  targetDurationMinutes: 60, splittable: false, done: false,
  createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z',
  notes: '摘要', place: '书桌',
}

describe('portable local data', () => {
  it('exports tasks as a versioned JSON document', () => {
    const exported = JSON.parse(buildExport([task])) as { version: number; tasks: StoredTask[] }
    expect(exported.version).toBe(1)
    expect(exported.tasks).toEqual([task])
  })

  it('round-trips optional task details', () => {
    const imported = parseImport(buildExport([task]))
    expect(imported.ok).toBe(true)
    expect(imported.tasks[0]).toEqual(task)
  })

  it('rejects malformed import without throwing', () => {
    const imported = parseImport('{not json')
    expect(imported).toMatchObject({ ok: false, error: 'BAD_JSON' })
  })

  it('rejects an import with missing task identity', () => {
    const imported = parseImport(JSON.stringify({ version: 1, tasks: [{ title: '无 id' }] }))
    expect(imported).toMatchObject({ ok: false, error: 'INVALID_TASK_DATA' })
  })

  it('rejects unknown future document versions', () => {
    const imported = parseImport(JSON.stringify({ version: 99, tasks: [] }))
    expect(imported).toMatchObject({ ok: false, error: 'UNSUPPORTED_VERSION' })
  })

  it('exports an empty list without inventing a task', () => {
    expect(parseImport(buildExport([]))).toMatchObject({ ok: true, tasks: [] })
  })

  it('round-trips recurring templates with their task data', () => {
    const template = { id: 'daily', title: '吃药', importance: 'important' as const, splittable: false, rule: { kind: 'daily' as const, startDate: '2026-08-29' }, createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z', paused: false }
    const imported = parseImport(buildExport([task], [template]))
    expect(imported).toMatchObject({ ok: true, templates: [template] })
  })
})
