import { describe, expect, it } from 'vitest'
import { buildTimelineEntries, type PlanBlock, type PlannerSettings } from '../index'

const settings: PlannerSettings = {
  timezone: 'Asia/Shanghai', planningDate: '2026-08-30', availabilityStartLocalTime: '08:00', availabilityEndLocalTime: '23:30', dailyBufferMinutes: 45,
  rest: { enabled: true, startLocalTime: '23:30', endLocalTime: '07:30' },
}
const block: PlanBlock = { taskId: 'report', startAt: '2026-08-30T01:00:00.000Z', endAt: '2026-08-30T02:30:00.000Z', source: 'automatic', reasonCodes: [] }

describe('timeline presentation entries', () => {
  it('keeps task blocks and adds a formal rest entry', () => {
    const entries = buildTimelineEntries([block], settings)
    expect(entries.map((entry) => entry.kind)).toEqual(['task', 'buffer', 'rest'])
    expect(entries[2]).toMatchObject({ title: '休息', startAt: '2026-08-30T15:30:00.000Z', endAt: '2026-08-30T23:30:00.000Z' })
  })

  it('marks the daily buffer as planned time, not an empty gap', () => {
    const entries = buildTimelineEntries([], settings)
    expect(entries).toContainEqual({ kind: 'buffer', title: '缓冲', startAt: '2026-08-30T14:45:00.000Z', endAt: '2026-08-30T15:30:00.000Z' })
  })

  it('does not add disabled rest or zero-length buffer entries', () => {
    const noRest = { ...settings, dailyBufferMinutes: 0, rest: { ...settings.rest, enabled: false } }
    expect(buildTimelineEntries([], noRest)).toEqual([])
  })
})
