import type { StoredTask } from './index'

// Monday-based ISO week key like 2026-W35 — the review shows once per week.
// Uses the local calendar, matching completedThisWeek below.
export function weekKey(now: string): string {
  const date = new Date(now)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayNumber = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNumber + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`
}

const DAY = 86400000

// Titles completed inside the current Monday-Sunday week, with counts.
export function completedThisWeek(tasks: StoredTask[], now: string): Array<{ title: string; count: number }> {
  const date = new Date(now)
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
  const start = monday.getTime()
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (!task.done || task.completedAt === undefined) continue
    const at = Date.parse(task.completedAt)
    if (at >= start && at < start + 7 * DAY) counts.set(task.title, (counts.get(task.title) ?? 0) + 1)
  }
  return [...counts.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => a.title.localeCompare(b.title))
}
