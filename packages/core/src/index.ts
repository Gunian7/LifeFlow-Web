export { themes, themeIds, defaultTheme, getTheme } from './theme'
export type { ThemeId, ThemeDefinition, ThemeTokens } from './theme'
export { selectCarryoverTasks } from './carryover'
export type { CarryoverItem } from './carryover'
export { completedThisWeek, weekKey } from './weekly'
export { buildBriefingFacts } from './briefing'
export type { BriefingFacts, BriefingInput } from './briefing'
export { buildStatsFacts } from './stats'
export type { StatsFacts, DayCompletion } from './stats'

export type Importance = 'must' | 'important' | 'want'
export type TaskStatus = 'inbox' | 'planned' | 'inProgress' | 'completed' | 'skipped' | 'deferred' | 'cancelled'
export type ConstraintStrength = 'hard' | 'semiHard' | 'soft'
export type Feasibility = 'feasible' | 'feasibleWithTradeoffs' | 'infeasible'
export type ReasonCode =
  | 'MUST_IMPORTANCE' | 'IMPORTANT_IMPORTANCE' | 'INSUFFICIENT_TIME'
  | 'ESTIMATE_REQUIRED' | 'FIXED_BLOCK_PROTECTED' | 'DEADLINE_TODAY'
  | 'DEADLINE_URGENT' | 'SPLIT_TO_FIT' | 'REST_PROTECTION'
  | 'PRESERVED_BUFFER' | 'CONFLICT_REQUIRES_DECISION'
  | 'MANUALLY_LOCKED' | 'IN_PROGRESS_PROTECTED' | 'USER_FORCED_TODAY'

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
  notes?: string
  place?: string
  completedAt?: string
  lockedStartAt?: string
  lockedEndAt?: string
  templateId?: string
  occurrenceDate?: string
  // User decisions from the overflow prompt. forceToday lets a task consume
  // the buffer and the rest window (up to the rest end, e.g. next morning);
  // deferredUntil (a date) parks it until that day's plan.
  forceToday?: boolean
  deferredUntil?: string
}

export type StoredTask = PlannerTask & {
  createdAt: string
  updatedAt: string
  done: boolean
}

export interface TaskDraft {
  title: string
  importance: Importance
  splittable: boolean
  notes?: string
  place?: string
  targetDurationMinutes?: number
  deadlineAt?: string
}

export interface TaskIssue {
  code: string
  fieldPath: string
  message: string
}

export interface TaskEditResult {
  task?: StoredTask
  issues: TaskIssue[]
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
  // Scheduling preference (e.g. adopted AI advice). A preference, never a
  // guarantee: rest, buffer, locks and feasibility rules still decide.
  preferredOrder?: string[]
}

export interface PlanBlock {
  taskId: string
  startAt: string
  endAt: string
  source: 'automatic' | 'manualLock'
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

export interface ExistingPlanBlock {
  taskId: string
  startAt: string
  endAt: string
  source: 'automatic' | 'manualLock'
}

export type PlanChangeKind = 'ADDED' | 'MOVED' | 'REMOVED'
export interface PlanChange {
  taskId: string
  kind: PlanChangeKind
  previousStartAt?: string
  newStartAt?: string
}

export interface ReplanInput extends PlannerInput {
  existingBlocks: ExistingPlanBlock[]
}

export interface TimelineTaskEntry extends PlanBlock { kind: 'task'; title?: string }
export interface TimelineSpecialEntry { kind: 'rest' | 'buffer'; title: string; startAt: string; endAt: string }
export type TimelineEntry = TimelineTaskEntry | TimelineSpecialEntry
export interface ReplanResult extends PlannerResult {
  stalePlanBlocks: PlanBlock[]
  changes: PlanChange[]
}

export function buildTimelineEntries(blocks: PlanBlock[], settings: PlannerSettings): TimelineEntry[] {
  const entries: TimelineEntry[] = blocks.map((block) => ({ ...block, kind: 'task' as const }))
  const offset = offsetFor(settings.timezone)
  const startMinutes = minutesOf(settings.availabilityStartLocalTime)
  const endMinutes = minutesOf(settings.availabilityEndLocalTime)
  if (Number.isNaN(offset) || startMinutes < 0 || endMinutes < 0 || startMinutes === endMinutes) return entries
  let windowEnd = localMs(settings.planningDate, endMinutes, offset)
  if (endMinutes < startMinutes) windowEnd += DAY
  if (settings.rest.enabled) {
    const restStart = minutesOf(settings.rest.startLocalTime)
    const restEnd = minutesOf(settings.rest.endLocalTime)
    if (restStart >= 0 && restEnd >= 0) {
      let start = localMs(settings.planningDate, restStart, offset)
      let end = localMs(settings.planningDate, restEnd, offset)
      if (restStart < startMinutes) start += DAY
      if (restEnd <= restStart) end += DAY
      if (start < end) entries.push({ kind: 'rest', title: '休息', startAt: iso(start), endAt: iso(end) })
    }
  }
  if (settings.dailyBufferMinutes > 0) {
    const start = windowEnd - settings.dailyBufferMinutes * MINUTE
    if (start < windowEnd) entries.push({ kind: 'buffer', title: '缓冲', startAt: iso(start), endAt: iso(windowEnd) })
  }
  return entries.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || (a.title ?? '').localeCompare(b.title ?? ''))
}

function cleanOptional(value: string | undefined): string | undefined {
  const clean = value?.trim()
  return clean ? clean : undefined
}

function taskFromDraft(draft: TaskDraft, id: string, now: string, existing?: StoredTask): StoredTask {
  const target = draft.targetDurationMinutes
  const splittable = draft.splittable && target !== undefined && target > 50
  return {
    id, title: draft.title.trim(), status: existing?.status ?? 'inbox', importance: draft.importance,
    targetDurationMinutes: target, minimumDurationMinutes: target === undefined ? undefined : (splittable ? 25 : target),
    splittable, minChunkMinutes: splittable ? 25 : undefined, deadlineAt: cleanOptional(draft.deadlineAt),
    notes: cleanOptional(draft.notes), place: cleanOptional(draft.place), createdAt: existing?.createdAt ?? now,
    updatedAt: now, completedAt: existing?.completedAt, done: existing?.done ?? false,
  }
}

export function createTask(draft: TaskDraft, now: string, id: string): TaskEditResult {
  if (!draft.title.trim()) return { issues: [{ code: 'TITLE_REQUIRED', fieldPath: 'title', message: 'title required' }] }
  const target = draft.targetDurationMinutes
  if (target !== undefined && (!Number.isInteger(target) || target <= 0)) return { issues: [{ code: 'INVALID_TASK_DURATION', fieldPath: 'targetDurationMinutes', message: 'positive integer required' }] }
  return { task: taskFromDraft(draft, id, now), issues: [] }
}

export function editTask(existing: StoredTask, draft: TaskDraft, now: string): TaskEditResult {
  if (!draft.title.trim()) return { issues: [{ code: 'TITLE_REQUIRED', fieldPath: 'title', message: 'title required' }] }
  const target = draft.targetDurationMinutes
  if (target !== undefined && (!Number.isInteger(target) || target <= 0)) return { issues: [{ code: 'INVALID_TASK_DURATION', fieldPath: 'targetDurationMinutes', message: 'positive integer required' }] }
  return { task: taskFromDraft(draft, existing.id, now, existing), issues: [] }
}

export function completeTask(task: StoredTask, now: string): StoredTask { return { ...task, status: 'completed', done: true, completedAt: now, updatedAt: now } }
export function uncompleteTask(task: StoredTask, now: string): StoredTask { return { ...task, status: 'inbox', done: false, completedAt: undefined, updatedAt: now } }
export function deleteTask(tasks: StoredTask[], id: string): StoredTask[] { return tasks.filter(task => task.id !== id) }

export interface PinResult { task?: StoredTask; issue?: 'ESTIMATE_REQUIRED_TO_PIN' | 'INVALID_PIN_TIME' | 'PIN_IN_THE_PAST' }
function pinMinutes(value: string): number { const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : -1 }
export function pinTask(task: StoredTask, localTime: string, planningDate: string, timezone: string, now: string): PinResult {
  const minutes = pinMinutes(localTime)
  const offset = timezone === 'Asia/Shanghai' ? 480 : timezone === 'UTC' ? 0 : NaN
  if (task.targetDurationMinutes === undefined) return { issue: 'ESTIMATE_REQUIRED_TO_PIN' }
  if (minutes < 0 || Number.isNaN(offset)) return { issue: 'INVALID_PIN_TIME' }
  let start = Date.parse(`${planningDate}T00:00:00Z`) + (minutes - offset) * MINUTE
  if (minutes < 480) start += DAY
  if (start < Date.parse(now)) return { issue: 'PIN_IN_THE_PAST' }
  return { task: { ...task, lockedStartAt: iso(start), lockedEndAt: iso(start + task.targetDurationMinutes * MINUTE), updatedAt: now } }
}
export function unpinTask(task: StoredTask, now: string): StoredTask { return { ...task, lockedStartAt: undefined, lockedEndAt: undefined, updatedAt: now } }

export interface RecurrenceRule { kind: 'daily' | 'weekly'; weekdays?: number[]; startDate: string; endDate?: string }
export interface RecurringTemplate { id: string; title: string; importance: Importance; targetDurationMinutes?: number; splittable: boolean; notes?: string; place?: string; rule: RecurrenceRule; createdAt: string; updatedAt: string; paused: boolean }
export function createTemplate(id: string, title: string, rule: RecurrenceRule, now: string): RecurringTemplate {
  return { id, title, importance: 'important', splittable: false, rule, createdAt: now, updatedAt: now, paused: false }
}
function applies(rule: RecurrenceRule, date: string): boolean {
  if (date < rule.startDate || (rule.endDate !== undefined && date > rule.endDate)) return false
  return rule.kind === 'daily' || (rule.weekdays ?? []).includes(new Date(`${date}T00:00:00Z`).getUTCDay())
}
export function materializeOccurrences(templates: RecurringTemplate[], existing: StoredTask[], date: string, now: string): StoredTask[] {
  const result = [...existing]
  for (const template of templates) {
    if (template.paused || !applies(template.rule, date) || result.some(task => task.templateId === template.id && task.occurrenceDate === date)) continue
    result.push({ id: `${template.id}-${date}`, title: template.title, status: 'inbox', importance: template.importance, targetDurationMinutes: template.targetDurationMinutes, splittable: template.splittable, notes: template.notes, place: template.place, createdAt: now, updatedAt: now, done: false, templateId: template.id, occurrenceDate: date })
  }
  return result
}


export interface ExportDocument {
  version: 1
  exportedAt: string
  tasks: StoredTask[]
  templates: RecurringTemplate[]
}
export interface ImportResult {
  ok: boolean
  tasks: StoredTask[]
  templates: RecurringTemplate[]
  error?: 'BAD_JSON' | 'UNSUPPORTED_VERSION' | 'INVALID_TASK_DATA'
}

export function buildExport(tasks: StoredTask[], templates: RecurringTemplate[] = []): string {
  const document: ExportDocument = { version: 1, exportedAt: new Date().toISOString(), tasks, templates }
  return JSON.stringify(document, null, 2)
}

export function parseImport(raw: string): ImportResult {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { ok: false, tasks: [], templates: [], error: 'BAD_JSON' } }
  if (!parsed || typeof parsed !== 'object') return { ok: false, tasks: [], templates: [], error: 'BAD_JSON' }
  const document = parsed as { version?: unknown; tasks?: unknown; templates?: unknown }
  if (document.version !== 1) return { ok: false, tasks: [], templates: [], error: 'UNSUPPORTED_VERSION' }
  if (!Array.isArray(document.tasks)) return { ok: false, tasks: [], templates: [], error: 'INVALID_TASK_DATA' }
  for (const item of document.tasks) {
    if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string' || typeof (item as { title?: unknown }).title !== 'string') {
      return { ok: false, tasks: [], templates: [], error: 'INVALID_TASK_DATA' }
    }
  }
  return { ok: true, tasks: document.tasks as StoredTask[], templates: Array.isArray(document.templates) ? document.templates as RecurringTemplate[] : [] }
}

export interface ImportMergeResult { tasks: StoredTask[]; added: number; replaced: number; keptLocal: number }
export function mergeImportedTasks(local: StoredTask[], imported: StoredTask[]): ImportMergeResult {
  const byId = new Map(local.map((task) => [task.id, task]))
  let added = 0; let replaced = 0; let keptLocal = 0
  for (const incoming of imported) {
    const current = byId.get(incoming.id)
    if (current === undefined) { byId.set(incoming.id, incoming); added += 1; continue }
    if (Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt)) { byId.set(incoming.id, incoming); replaced += 1 }
    else keptLocal += 1
  }
  return { tasks: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), added, replaced, keptLocal }
}

export type InventoryGroupKey = 'today' | 'waiting' | 'needsEstimate' | 'completed'
export interface InventoryItem { taskId: string; title: string; minutes?: number; recurring: boolean; pinned: boolean }
export interface InventoryGroup { key: InventoryGroupKey; items: InventoryItem[] }
export function inventory(tasks: StoredTask[], scheduledIds: string[]): InventoryGroup[] {
  const keys: InventoryGroupKey[] = ['today', 'waiting', 'needsEstimate', 'completed']
  const groups = new Map<InventoryGroupKey, InventoryItem[]>()
  for (const task of tasks) {
    if (task.status === 'cancelled') continue
    const key: InventoryGroupKey = task.status === 'completed' ? 'completed' : (scheduledIds.includes(task.id) || task.status === 'inProgress') ? 'today' : task.targetDurationMinutes === undefined ? 'needsEstimate' : 'waiting'
    const item: InventoryItem = { taskId: task.id, title: task.title, minutes: task.targetDurationMinutes, recurring: task.templateId !== undefined, pinned: task.lockedStartAt !== undefined }
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const result: InventoryGroup[] = []
  for (const key of keys) {
    const items = groups.get(key)
    if (!items?.length) continue
    items.sort((a, b) => a.title.localeCompare(b.title))
    result.push({ key, items })
  }
  return result
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

// Try to book a task into the given slots. Returns the chunks to reserve
// (already constrained by the task's deadline) or null when nothing fits.
function bookTask(task: PlannerTask, slots: Slot[], now: number, dayEnd: number): { chunks: Slot[]; reasonCodes: ReasonCode[] } | null {
  const target = task.targetDurationMinutes
  if (target === undefined) return null
  const targetMs = target * MINUTE
  const latestEnd = task.deadlineAt === undefined ? Infinity : Date.parse(task.deadlineAt)
  if (!task.splittable) {
    for (const slot of slots) {
      const usableEnd = Math.min(slot.end, latestEnd)
      if (usableEnd - slot.start < targetMs) continue
      return { chunks: [{ start: slot.start, end: slot.start + targetMs }], reasonCodes: reasonFor(task, now, dayEnd) }
    }
    return null
  }
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
    return { chunks: staged, reasonCodes: [...reasonFor(task, now, dayEnd), ...split] }
  }
  return null
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

  const orderIndex = new Map((input.preferredOrder ?? []).map((id, index) => [id, index]))
  const candidates = input.tasks
    .filter(task => ['inbox', 'planned', 'deferred'].includes(task.status) && !(task.deferredUntil !== undefined && task.deferredUntil > input.settings.planningDate))
    .sort((a, b) => {
      const ao = orderIndex.get(a.id) ?? Number.POSITIVE_INFINITY
      const bo = orderIndex.get(b.id) ?? Number.POSITIVE_INFINITY
      if (ao !== bo) return ao - bo
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
    const booking = bookTask(task, slots, now, endMs)
    if (booking) {
      for (const chunk of booking.chunks) {
        planBlocks.push({ taskId: task.id, startAt: iso(chunk.start), endAt: iso(chunk.end), source: 'automatic', reasonCodes: booking.reasonCodes })
        slots = subtract(slots, chunk)
      }
    } else {
      const codes: ReasonCode[] = []
      if (fits(beforeBuffer, task, latestEnd, target)) codes.push('PRESERVED_BUFFER', 'CONFLICT_REQUIRES_DECISION')
      else if (fits(beforeRest, task, latestEnd, target)) codes.push('REST_PROTECTION', 'CONFLICT_REQUIRES_DECISION')
      else codes.push('INSUFFICIENT_TIME')
      unscheduledTasks.push({ taskId: task.id, reasonCodes: codes, remainingTargetMinutes: target })
    }
  }

  // Second pass for tasks the user explicitly forced into today: release the
  // buffer and the rest window, capped at the end of the rest window (or the
  // window end plus buffer when rest is off) — at most the next morning.
  const forcedCandidates = candidates.filter(task => task.forceToday === true && task.targetDurationMinutes !== undefined && !planBlocks.some(block => block.taskId === task.id) && unscheduledTasks.some(item => item.taskId === task.id))
  if (forcedCandidates.length > 0) {
    let extendedEnd = endMs + buffer
    if (input.settings.rest.enabled) {
      const restEndMinutes = minutesOf(input.settings.rest.endLocalTime)
      const restStartMinutes = minutesOf(input.settings.rest.startLocalTime)
      if (restEndMinutes >= 0 && restStartMinutes >= 0) {
        let restEndMs = localMs(input.settings.planningDate, restEndMinutes, offset)
        if (restEndMinutes <= restStartMinutes) restEndMs += DAY
        extendedEnd = Math.max(extendedEnd, restEndMs)
      }
    }
    let extended: Slot[] = beforeRest.map((slot, index, all) => index === all.length - 1 && slot.end < extendedEnd ? { start: slot.start, end: extendedEnd } : slot)
    for (const block of planBlocks) extended = subtract(extended, { start: Date.parse(block.startAt), end: Date.parse(block.endAt) })
    for (const task of forcedCandidates) {
      const booking = bookTask(task, extended, now, extendedEnd)
      if (!booking) continue
      for (const chunk of booking.chunks) {
        planBlocks.push({ taskId: task.id, startAt: iso(chunk.start), endAt: iso(chunk.end), source: 'automatic', reasonCodes: [...booking.reasonCodes, 'USER_FORCED_TODAY'] })
        extended = subtract(extended, chunk)
      }
      const index = unscheduledTasks.findIndex(item => item.taskId === task.id)
      if (index >= 0) unscheduledTasks.splice(index, 1)
    }
  }
  planBlocks.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.taskId.localeCompare(b.taskId))
  const mustFailure = unscheduledTasks.some(item => input.tasks.find(task => task.id === item.taskId)?.importance === 'must')
  const importantFailure = unscheduledTasks.some(item => input.tasks.find(task => task.id === item.taskId)?.importance === 'important')
  return { feasibility: mustFailure ? 'infeasible' : importantFailure ? 'feasibleWithTradeoffs' : 'feasible', planBlocks, unscheduledTasks, validationIssues: [] }
}

export function replanToday(input: ReplanInput): ReplanResult {
  const now = Date.parse(input.now)
  const protectedIds = new Set<string>()
  const stalePlanBlocks: PlanBlock[] = []
  const protectedFixed: PlannerFixedBlock[] = []

  // A task's own lock is a user fact even before the first plan snapshot exists.
  // Materialize it as a protected block so the first Replan and every later one
  // follow the same rule.
  for (const task of input.tasks) {
    if (task.lockedStartAt === undefined || task.lockedEndAt === undefined) continue
    if (['completed', 'cancelled', 'skipped'].includes(task.status)) continue
    protectedIds.add(task.id)
    protectedFixed.push({ id: `task-lock-${task.id}`, title: task.title, startAt: task.lockedStartAt, endAt: task.lockedEndAt, strength: 'hard', movable: false })
  }

  for (const old of input.existingBlocks) {
    const task = input.tasks.find(candidate => candidate.id === old.taskId)
    if (!task || ['completed', 'cancelled', 'skipped'].includes(task.status)) continue
    const start = Date.parse(old.startAt)
    const end = Date.parse(old.endAt)
    if (old.source === 'manualLock' || (start <= now && now < end)) {
      protectedIds.add(old.taskId)
      protectedFixed.push({ id: `protected-${old.taskId}`, title: old.taskId, startAt: old.startAt, endAt: old.endAt, strength: 'hard', movable: false })
    } else if (end <= now) {
      protectedIds.add(old.taskId)
      stalePlanBlocks.push({ taskId: old.taskId, startAt: old.startAt, endAt: old.endAt, source: 'automatic', reasonCodes: [] })
    }
  }

  const planned = planToday({
    now: input.now,
    settings: input.settings,
    tasks: input.tasks.filter(task => !protectedIds.has(task.id)),
    fixedBlocks: [...input.fixedBlocks, ...protectedFixed],
    preferredOrder: input.preferredOrder,
  })
  const planBlocks = [...planned.planBlocks]
  for (const task of input.tasks) {
    if (!protectedIds.has(task.id) || task.lockedStartAt === undefined || task.lockedEndAt === undefined) continue
    if (planBlocks.some(block => block.taskId === task.id)) continue
    planBlocks.push({ taskId: task.id, startAt: task.lockedStartAt, endAt: task.lockedEndAt, source: 'manualLock', reasonCodes: ['MANUALLY_LOCKED'] })
  }
  for (const old of input.existingBlocks) {
    if (!protectedIds.has(old.taskId) || stalePlanBlocks.some(block => block.taskId === old.taskId)) continue
    planBlocks.push({ taskId: old.taskId, startAt: old.startAt, endAt: old.endAt, source: old.source, reasonCodes: old.source === 'manualLock' ? ['MANUALLY_LOCKED'] : ['IN_PROGRESS_PROTECTED'] })
  }
  planBlocks.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.taskId.localeCompare(b.taskId))

  const changes: PlanChange[] = []
  const currentIds = new Set(planBlocks.map(block => block.taskId))
  for (const block of planBlocks) {
    if (protectedIds.has(block.taskId)) continue
    const old = input.existingBlocks.find(candidate => candidate.taskId === block.taskId)
    if (!old) changes.push({ taskId: block.taskId, kind: 'ADDED', newStartAt: block.startAt })
    else if (old.startAt !== block.startAt || old.endAt !== block.endAt) changes.push({ taskId: block.taskId, kind: 'MOVED', previousStartAt: old.startAt, newStartAt: block.startAt })
  }
  for (const old of input.existingBlocks) {
    if (!protectedIds.has(old.taskId) && !currentIds.has(old.taskId)) changes.push({ taskId: old.taskId, kind: 'REMOVED', previousStartAt: old.startAt })
  }
  changes.sort((a, b) => a.taskId.localeCompare(b.taskId))
  return { ...planned, planBlocks, stalePlanBlocks, changes }
}
