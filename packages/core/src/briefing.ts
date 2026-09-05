import type { PlannerSettings, StoredTask } from './index'

const MINUTE = 60_000

export interface BriefingFacts {
  date: string
  taskCount: number
  mustCount: number
  firstTask?: { title: string; startLocal: string }
  unscheduledCount: number
  deferredCount: number
  carriedCount: number
  bufferMinutes: number
  restWindow?: { start: string; end: string }
  windowStart: string
  windowEnd: string
}

export interface BriefingInput {
  tasks: StoredTask[]
  planBlocks: Array<{ taskId: string; startAt: string; endAt: string }>
  unscheduledCount: number
  deferredCount: number
  carriedCount: number
  settings: PlannerSettings
  now: string
}

function offsetFor(timezone: string): number {
  return timezone === 'Asia/Shanghai' ? 480 : timezone === 'UTC' ? 0 : NaN
}

function localHhMm(iso: string, offset: number): string {
  const shifted = new Date(Date.parse(iso) + offset * MINUTE)
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`
}

// The honest facts for today's plan. The morning card renders them as-is;
// an LLM at most rephrases them — it never adds facts.
export function buildBriefingFacts(input: BriefingInput): BriefingFacts {
  const offset = offsetFor(input.settings.timezone)
  const openTasks = new Map(input.tasks.filter((task) => !task.done).map((task) => [task.id, task]))
  const blocks = input.planBlocks
    .filter((block) => openTasks.has(block.taskId))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
  const first = blocks.find((block) => Date.parse(block.endAt) > Date.parse(input.now)) ?? blocks[0]
  const firstTask = first ? openTasks.get(first.taskId) : undefined
  const mustCount = blocks.filter((block) => openTasks.get(block.taskId)?.importance === 'must').length
  const facts: BriefingFacts = {
    date: input.settings.planningDate,
    taskCount: blocks.length,
    mustCount,
    unscheduledCount: input.unscheduledCount,
    deferredCount: input.deferredCount,
    carriedCount: input.carriedCount,
    bufferMinutes: input.settings.dailyBufferMinutes,
    windowStart: input.settings.availabilityStartLocalTime,
    windowEnd: input.settings.availabilityEndLocalTime,
  }
  if (first && firstTask) facts.firstTask = { title: firstTask.title, startLocal: localHhMm(first.startAt, offset) }
  if (input.settings.rest.enabled) facts.restWindow = { start: input.settings.rest.startLocalTime, end: input.settings.rest.endLocalTime }
  return facts
}
