import { describe, expect, it } from 'vitest'
import { createTask, editTask, completeTask, uncompleteTask, deleteTask, type StoredTask, type TaskDraft } from '../index'

const NOW = '2026-08-29T00:00:00.000Z'
const LATER = '2026-08-29T01:00:00.000Z'
const draft: TaskDraft = { title: '写报告', importance: 'important', splittable: false }

describe('shared task editing', () => {
  it('creates a task with only a title', () => {
    const result = createTask(draft, NOW, 'a')
    expect(result.task).toMatchObject({ id: 'a', title: '写报告', status: 'inbox', createdAt: NOW })
  })

  it('preserves optional description and place', () => {
    const result = createTask({ ...draft, notes: '带数据', place: '书桌', targetDurationMinutes: 60 }, NOW, 'a')
    expect(result.task).toMatchObject({ notes: '带数据', place: '书桌', targetDurationMinutes: 60 })
  })

  it('rejects blank titles', () => {
    const result = createTask({ ...draft, title: '  ' }, NOW, 'a')
    expect(result.task).toBeUndefined()
    expect(result.issues[0].code).toBe('TITLE_REQUIRED')
  })

  it('edits fields while preserving identity and creation time', () => {
    const original = createTask(draft, NOW, 'a').task!
    const edited = editTask(original, { ...draft, title: '写季度报告', notes: '先写摘要' }, LATER).task!
    expect(edited).toMatchObject({ id: 'a', title: '写季度报告', notes: '先写摘要', createdAt: NOW, updatedAt: LATER })
  })

  it('clears optional fields when they are omitted on edit', () => {
    const original = createTask({ ...draft, notes: '旧备注', place: '实验室' }, NOW, 'a').task!
    const edited = editTask(original, draft, LATER).task!
    expect(edited.notes).toBeUndefined()
    expect(edited.place).toBeUndefined()
  })

  it('completes and undoes completion without losing details', () => {
    const original = createTask({ ...draft, notes: '摘要', place: '书桌' }, NOW, 'a').task!
    const done = completeTask(original, LATER)
    expect(done.status).toBe('completed')
    expect(done.completedAt).toBe(LATER)
    const back = uncompleteTask(done, NOW)
    expect(back).toMatchObject({ status: 'inbox', notes: '摘要', place: '书桌' })
    expect(back.completedAt).toBeUndefined()
  })

  it('deletes only the requested task', () => {
    const a = createTask(draft, NOW, 'a').task!
    const b = createTask({ ...draft, title: '另一件事' }, NOW, 'b').task!
    expect(deleteTask([a, b], 'a').map((task) => task.id)).toEqual(['b'])
  })
})
