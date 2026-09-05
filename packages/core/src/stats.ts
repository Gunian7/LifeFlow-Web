import type { StoredTask } from './index'

const DAY = 86400000

export interface DayCompletion { date: string; label: string; completed: number }
export interface StatsFacts {
  days: DayCompletion[]
  openByImportance: { must: number; important: number; want: number }
  totalCompleted: number
}

// Completion counts for the last N days plus the open task distribution by
// importance. All computed locally — no LLM, no server.
export function buildStatsFacts(tasks: StoredTask[], now: string, window: number): StatsFacts {
  const today = new Date(now)
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days: DayCompletion[] = []
  for (let i = window - 1; i >= 0; i--) {
    const dayStart = todayLocal.getTime() - i * DAY
    const dayEnd = dayStart + DAY
    const date = new Date(dayStart)
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const label = `${date.getMonth() + 1}/${date.getDate()}`
    const completed = tasks.filter((task) => task.done && task.completedAt !== undefined && Date.parse(task.completedAt) >= dayStart && Date.parse(task.completedAt) < dayEnd).length
    days.push({ date: dateStr, label, completed })
  }
  const open = tasks.filter((task) => !task.done)
  const openByImportance = {
    must: open.filter((task) => task.importance === 'must').length,
    important: open.filter((task) => task.importance === 'important').length,
    want: open.filter((task) => task.importance === 'want').length,
  }
  const totalCompleted = tasks.filter((task) => task.done).length
  return { days, openByImportance, totalCompleted }
}
