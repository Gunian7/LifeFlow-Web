export type Importance = 'must' | 'important' | 'want'
export type TaskStatus = 'inbox' | 'planned' | 'inProgress' | 'completed' | 'skipped' | 'deferred' | 'cancelled'
export type ConstraintStrength = 'hard' | 'semiHard' | 'soft'
export type Feasibility = 'feasible' | 'feasibleWithTradeoffs' | 'infeasible'
export type ReasonCode =
  | 'MUST_IMPORTANCE' | 'IMPORTANT_IMPORTANCE' | 'INSUFFICIENT_TIME'
  | 'ESTIMATE_REQUIRED' | 'FIXED_BLOCK_PROTECTED'

export interface PlannerTask {
  id: string
  title: string
  status: TaskStatus
  importance: Importance
  targetDurationMinutes?: number
  minimumDurationMinutes?: number
  splittable: boolean
}

export interface PlannerFixedBlock {
  id: string
  title: string
  startAt: string
  endAt: string
  strength: ConstraintStrength
  movable: boolean
}

export interface PlannerSettings {
  timezone: string
  planningDate: string
  availabilityStartLocalTime: string
  availabilityEndLocalTime: string
  dailyBufferMinutes: number
  rest: { enabled: boolean; startLocalTime: string; endLocalTime: string }
}

export interface PlannerInput {
  now: string
  settings: PlannerSettings
  tasks: PlannerTask[]
  fixedBlocks: PlannerFixedBlock[]
}

export interface PlanBlock {
  taskId: string
  startAt: string
  endAt: string
  source: 'automatic'
  reasonCodes: ReasonCode[]
}

export interface UnscheduledTask {
  taskId: string
  reasonCodes: ReasonCode[]
  remainingTargetMinutes?: number
}

export interface PlannerResult {
  feasibility: Feasibility
  planBlocks: PlanBlock[]
  unscheduledTasks: UnscheduledTask[]
  validationIssues: string[]
}

type Slot = { start: number; end: number }
const MINUTE = 60_000
const offsetFor = (timezone: string) => timezone === 'Asia/Shanghai' ? 480 : timezone === 'UTC' ? 0 : NaN
const minutesOf = (value: string) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1
}
const localMs = (date: string, minutes: number, offset: number) => Date.parse(`${date}T00:00:00Z`) + (minutes - offset) * MINUTE
const iso = (ms: number) => new Date(ms).toISOString()

function subtract(slots: Slot[], cut: Slot): Slot[] {
  const result: Slot[] = []
  for (const slot of slots) {
    if (cut.end <= slot.start || cut.start >= slot.end) { result.push(slot); continue }
    if (slot.start < cut.start) result.push({ start: slot.start, end: cut.start })
    if (cut.end < slot.end) result.push({ start: cut.end, end: slot.end })
  }
  return result.filter(slot => slot.start < slot.end)
}

function importanceRank(value: Importance) { return value === 'must' ? 0 : value === 'important' ? 1 : 2 }
function reasons(task: PlannerTask): ReasonCode[] {
  return task.importance === 'must' ? ['MUST_IMPORTANCE'] : task.importance === 'important' ? ['IMPORTANT_IMPORTANCE'] : []
}

export function planToday(input: PlannerInput): PlannerResult {
  const offset = offsetFor(input.settings.timezone)
  const start = minutesOf(input.settings.availabilityStartLocalTime)
  const end = minutesOf(input.settings.availabilityEndLocalTime)
  const now = Date.parse(input.now)
  if (Number.isNaN(offset) || start < 0 || end < 0 || start >= end || Number.isNaN(now)) {
    return { feasibility: 'infeasible', planBlocks: [], unscheduledTasks: [], validationIssues: ['INVALID_SETTINGS'] }
  }

  const startMs = Math.max(localMs(input.settings.planningDate, start, offset), now)
  const endMs = localMs(input.settings.planningDate, end, offset)
  let slots: Slot[] = startMs < endMs ? [{ start: startMs, end: endMs }] : []
  for (const fixed of input.fixedBlocks) {
    slots = subtract(slots, { start: Date.parse(fixed.startAt), end: Date.parse(fixed.endAt) })
  }

  // Reserve the daily buffer at the end of the available window.
  const buffer = input.settings.dailyBufferMinutes * MINUTE
  if (buffer > 0 && slots.length > 0) {
    const last = slots[slots.length - 1]
    if (last.end - last.start > buffer) slots = subtract(slots, { start: last.end - buffer, end: last.end })
  }

  const planBlocks: PlanBlock[] = []
  const unscheduledTasks: UnscheduledTask[] = []
  const candidates = input.tasks
    .filter(task => ['inbox', 'planned', 'deferred'].includes(task.status))
    .sort((a, b) => importanceRank(a.importance) - importanceRank(b.importance) || a.id.localeCompare(b.id))

  for (const task of candidates) {
    const target = task.targetDurationMinutes
    if (target === undefined) {
      unscheduledTasks.push({ taskId: task.id, reasonCodes: ['ESTIMATE_REQUIRED'] })
      continue
    }
    const need = target * MINUTE
    const index = slots.findIndex(slot => slot.end - slot.start >= need)
    if (index < 0) {
      unscheduledTasks.push({ taskId: task.id, reasonCodes: ['INSUFFICIENT_TIME'], remainingTargetMinutes: target })
      continue
    }
    const slot = slots[index]
    planBlocks.push({ taskId: task.id, startAt: iso(slot.start), endAt: iso(slot.start + need), source: 'automatic', reasonCodes: reasons(task) })
    slots = subtract(slots, { start: slot.start, end: slot.start + need })
  }

  const hasMustFailure = unscheduledTasks.some(item => {
    const task = input.tasks.find(candidate => candidate.id === item.taskId)
    return task?.importance === 'must'
  })
  const hasImportantFailure = unscheduledTasks.some(item => {
    const task = input.tasks.find(candidate => candidate.id === item.taskId)
    return task?.importance === 'important'
  })
  return {
    feasibility: hasMustFailure ? 'infeasible' : hasImportantFailure ? 'feasibleWithTradeoffs' : 'feasible',
    planBlocks,
    unscheduledTasks,
    validationIssues: [],
  }
}
