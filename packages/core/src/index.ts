export type Importance = 'must' | 'important' | 'want'
export type TaskStatus = 'inbox' | 'planned' | 'inProgress' | 'completed' | 'skipped' | 'deferred' | 'cancelled'
export type ConstraintStrength = 'hard' | 'semiHard' | 'soft'
export type Feasibility = 'feasible' | 'feasibleWithTradeoffs' | 'infeasible'
export type ReasonCode =
  | 'MUST_IMPORTANCE' | 'IMPORTANT_IMPORTANCE' | 'INSUFFICIENT_TIME'
  | 'ESTIMATE_REQUIRED' | 'FIXED_BLOCK_PROTECTED' | 'DEADLINE_TODAY'
  | 'DEADLINE_URGENT' | 'SPLIT_TO_FIT' | 'REST_PROTECTION'
  | 'PRESERVED_BUFFER' | 'CONFLICT_REQUIRES_DECISION'

export interface PlannerTask {
  id: string
  title: string
  status: TaskStatus
  importance: Importance
  targetDurationMinutes?: number
  minimumDurationMinutes?: number
  splittable: boolean
  minChunkMinutes?: number
  deadlineAt?: string
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
const DAY = 24 * 60 * MINUTE

function offsetFor(timezone: string): number { return timezone === 'Asia/Shanghai' ? 480 : timezone === 'UTC' ? 0 : NaN }
function minutesOf(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1
}
function localMs(date: string, minutes: number, offset: number): number { return Date.parse(`${date}T00:00:00Z`) + (minutes - offset) * MINUTE }
function iso(ms: number): string { return new Date(ms).toISOString() }
function subtract(slots: Slot[], cut: Slot): Slot[] {
  const result: Slot[] = []
  for (const slot of slots) {
    if (cut.end <= slot.start || cut.start >= slot.end) { result.push(slot); continue }
    if (slot.start < cut.start) result.push({ start: slot.start, end: cut.start })
    if (cut.end < slot.end) result.push({ start: cut.end, end: slot.end })
  }
  return result.filter(slot => slot.start < slot.end)
}
function importanceRank(value: Importance): number { return value === 'must' ? 0 : value === 'important' ? 1 : 2 }
function reasonFor(task: PlannerTask, now: number, windowEnd: number): ReasonCode[] {
  const result: ReasonCode[] = []
  if (task.deadlineAt !== undefined) {
    const deadline = Date.parse(task.deadlineAt)
    if (deadline <= windowEnd) result.push('DEADLINE_TODAY')
    if (deadline >= now && deadline - now <= 120 * MINUTE) result.push('DEADLINE_URGENT')
  }
  if (task.importance === 'must') result.push('MUST_IMPORTANCE')
  if (task.importance === 'important') result.push('IMPORTANT_IMPORTANCE')
  return result
}
function fits(slots: Slot[], task: PlannerTask, latestEnd: number, target: number): boolean {
  const targetMs = target * MINUTE
  if (!task.splittable) return slots.some(slot => Math.min(slot.end, latestEnd) - slot.start >= targetMs)
  const minimum = (task.minimumDurationMinutes ?? target) * MINUTE
  const chunk = (task.minChunkMinutes ?? 0) * MINUTE
  return slots.reduce((total, slot) => total + Math.max(0, Math.min(slot.end, latestEnd) - slot.start >= chunk ? Math.min(slot.end, latestEnd) - slot.start : 0), 0) >= minimum
}

export function planToday(input: PlannerInput): PlannerResult {
  const offset = offsetFor(input.settings.timezone)
  const startMinutes = minutesOf(input.settings.availabilityStartLocalTime)
  const endMinutes = minutesOf(input.settings.availabilityEndLocalTime)
  const now = Date.parse(input.now)
  if (Number.isNaN(offset) || startMinutes < 0 || endMinutes < 0 || startMinutes === endMinutes || Number.isNaN(now)) {
    return { feasibility: 'infeasible', planBlocks: [], unscheduledTasks: [], validationIssues: ['INVALID_SETTINGS'] }
  }

  const startMs = Math.max(localMs(input.settings.planningDate, startMinutes, offset), now)
  let endMs = localMs(input.settings.planningDate, endMinutes, offset)
  // end <= start is an after-midnight window, e.g. 23:00 -> 01:00.
  if (endMinutes < startMinutes) endMs += DAY
  let slots: Slot[] = startMs < endMs ? [{ start: startMs, end: endMs }] : []
  for (const fixed of input.fixedBlocks) slots = subtract(slots, { start: Date.parse(fixed.startAt), end: Date.parse(fixed.endAt) })

  const beforeRest = slots.slice()
  if (input.settings.rest.enabled) {
    const restStart = minutesOf(input.settings.rest.startLocalTime)
    const restEnd = minutesOf(input.settings.rest.endLocalTime)
    if (restStart >= 0 && restEnd >= 0) {
      let restStartMs = localMs(input.settings.planningDate, restStart, offset)
      if (restStart < startMinutes) restStartMs += DAY
      let restEndMs = localMs(input.settings.planningDate, restEnd, offset)
      if (restEnd <= restStart) restEndMs += DAY
      slots = subtract(slots, { start: restStartMs, end: restEndMs })
    }
  }
  const beforeBuffer = slots.slice()
  const buffer = input.settings.dailyBufferMinutes * MINUTE
  if (buffer > 0 && slots.length > 0) {
    const last = slots[slots.length - 1]
    if (last.end - last.start > buffer) slots = subtract(slots, { start: last.end - buffer, end: last.end })
  }

  const candidates = input.tasks
    .filter(task => ['inbox', 'planned', 'deferred'].includes(task.status))
    .sort((a, b) => {
      const ad = a.deadlineAt === undefined ? Infinity : Date.parse(a.deadlineAt)
      const bd = b.deadlineAt === undefined ? Infinity : Date.parse(b.deadlineAt)
      return ad - bd || importanceRank(a.importance) - importanceRank(b.importance) || Number(a.splittable) - Number(b.splittable) || (a.targetDurationMinutes ?? Infinity) - (b.targetDurationMinutes ?? Infinity) || a.id.localeCompare(b.id)
    })

  const planBlocks: PlanBlock[] = []
  const unscheduledTasks: UnscheduledTask[] = []
  for (const task of candidates) {
    if (task.targetDurationMinutes === undefined) { unscheduledTasks.push({ taskId: task.id, reasonCodes: ['ESTIMATE_REQUIRED'] }); continue }
    const target = task.targetDurationMinutes
    const latestEnd = task.deadlineAt === undefined ? Infinity : Date.parse(task.deadlineAt)
    const targetMs = target * MINUTE
    let placed = false
    if (!task.splittable) {
      for (const slot of slots) {
        const usableEnd = Math.min(slot.end, latestEnd)
        if (usableEnd - slot.start < targetMs) continue
        planBlocks.push({ taskId: task.id, startAt: iso(slot.start), endAt: iso(slot.start + targetMs), source: 'automatic', reasonCodes: reasonFor(task, now, endMs) })
        slots = subtract(slots, { start: slot.start, end: slot.start + targetMs })
        placed = true
        break
      }
    } else {
      const minimum = (task.minimumDurationMinutes ?? target) * MINUTE
      const minChunk = (task.minChunkMinutes ?? 0) * MINUTE
      const staged: Slot[] = []
      let allocated = 0
      for (const slot of slots) {
        if (allocated >= targetMs) break
        const available = Math.min(slot.end, latestEnd) - slot.start
        if (available < minChunk) continue
        const chunk = Math.min(available, targetMs - allocated)
        if (chunk < minChunk) break
        staged.push({ start: slot.start, end: slot.start + chunk }); allocated += chunk
      }
      if (allocated >= minimum) {
        const split = staged.length > 1 ? ['SPLIT_TO_FIT' as ReasonCode] : []
        for (const chunk of staged) { planBlocks.push({ taskId: task.id, startAt: iso(chunk.start), endAt: iso(chunk.end), source: 'automatic', reasonCodes: [...reasonFor(task, now, endMs), ...split] }); slots = subtract(slots, chunk) }
        placed = true
      }
    }
    if (!placed) {
      const codes: ReasonCode[] = []
      if (fits(beforeBuffer, task, latestEnd, target)) codes.push('PRESERVED_BUFFER', 'CONFLICT_REQUIRES_DECISION')
      else if (fits(beforeRest, task, latestEnd, target)) codes.push('REST_PROTECTION', 'CONFLICT_REQUIRES_DECISION')
      else codes.push('INSUFFICIENT_TIME')
      unscheduledTasks.push({ taskId: task.id, reasonCodes: codes, remainingTargetMinutes: target })
    }
  }
  planBlocks.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.taskId.localeCompare(b.taskId))
  const mustFailure = unscheduledTasks.some(item => input.tasks.find(task => task.id === item.taskId)?.importance === 'must')
  const importantFailure = unscheduledTasks.some(item => input.tasks.find(task => task.id === item.taskId)?.importance === 'important')
  return { feasibility: mustFailure ? 'infeasible' : importantFailure ? 'feasibleWithTradeoffs' : 'feasible', planBlocks, unscheduledTasks, validationIssues: [] }
}
