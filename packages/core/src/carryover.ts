import type { StoredTask } from './index'

export interface CarryoverItem { taskId: string; title: string; minutes?: number }

// Yesterday's leftovers: still open, untouched since before today, and not a
// recurring instance (those come back on their own and never get asked about).
// Dropped items carry no record — the caller decides what "letting go" means.
export function selectCarryoverTasks(tasks: StoredTask[], today: string): CarryoverItem[] {
  return tasks
    .filter((task) => {
      if (task.done || task.status === 'cancelled' || task.status === 'skipped') return false
      if (task.templateId !== undefined) return false
      return task.updatedAt.slice(0, 10) < today
    })
    .map((task) => ({ taskId: task.id, title: task.title, minutes: task.targetDurationMinutes }))
}
