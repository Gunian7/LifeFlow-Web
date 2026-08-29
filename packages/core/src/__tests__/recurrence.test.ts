import { describe, expect, it } from 'vitest'
import { materializeOccurrences, type RecurringTemplate, type StoredTask } from '../index'

const FRIDAY = '2026-08-29'
const SATURDAY = '2026-08-30'
function template(id: string, kind: 'daily' | 'weekly', weekdays?: number[]): RecurringTemplate {
  return { id, title: '吃药', importance: 'important', splittable: false, rule: { kind, weekdays, startDate: FRIDAY }, createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z', paused: false }
}

describe('shared recurrence rules', () => {
  it('creates one daily occurrence for the requested date', () => {
    const result = materializeOccurrences([template('medicine', 'daily')], [], FRIDAY, '2026-08-29T00:00:00Z')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ templateId: 'medicine', occurrenceDate: FRIDAY, title: '吃药' })
  })
  it('creates a weekly occurrence only on selected weekdays', () => {
    const weekly = template('meeting', 'weekly', [6])
    expect(materializeOccurrences([weekly], [], FRIDAY, '2026-08-29T00:00:00Z')).toHaveLength(1)
    expect(materializeOccurrences([weekly], [], SATURDAY, '2026-08-30T00:00:00Z')).toHaveLength(0)
  })
  it('is idempotent and does not backfill', () => {
    const daily = template('medicine', 'daily')
    const first = materializeOccurrences([daily], [], FRIDAY, '2026-08-29T00:00:00Z')
    expect(materializeOccurrences([daily], first, FRIDAY, '2026-08-29T01:00:00Z')).toHaveLength(1)
    expect(materializeOccurrences([daily], first, SATURDAY, '2026-08-30T00:00:00Z')).toHaveLength(2)
  })
  it('does not materialize while paused or outside the date range', () => {
    const paused = template('paused', 'daily'); paused.paused = true
    const ended = template('ended', 'daily'); ended.rule.endDate = FRIDAY
    expect(materializeOccurrences([paused], [], FRIDAY, '2026-08-29T00:00:00Z')).toEqual([])
    expect(materializeOccurrences([ended], [], SATURDAY, '2026-08-30T00:00:00Z')).toEqual([])
  })
  it('keeps existing independent instances untouched', () => {
    const existing: StoredTask = { id: 'old', title: '旧实例', status: 'completed', importance: 'important', splittable: false, createdAt: '2026-08-28T00:00:00Z', updatedAt: '2026-08-28T00:00:00Z', done: true, templateId: 'medicine', occurrenceDate: FRIDAY }
    const result = materializeOccurrences([template('medicine', 'daily')], [existing], FRIDAY, '2026-08-29T00:00:00Z')
    expect(result).toEqual([existing])
  })
})
