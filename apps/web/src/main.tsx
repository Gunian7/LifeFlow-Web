import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ExistingPlanBlock, Importance, PlannerFixedBlock, PlannerTask, StoredTask, TaskDraft, RecurrenceRule, RecurringTemplate, ThemeId } from '../../../packages/core/src'
import { buildExport, buildTimelineEntries, completedThisWeek, createTask, createTemplate, defaultTheme, deleteTask, editTask, getTheme, materializeOccurrences, mergeImportedTasks, parseImport, pinTask, replanToday, selectCarryoverTasks, weekKey, completeTask, uncompleteTask, unpinTask, themeIds } from '../../../packages/core/src'
import type { FocusSession } from '../../../packages/core/src/focus'
import { focusRemainingSeconds, pauseFocus, resumeFocus, startFocus } from '../../../packages/core/src/focus'
import { CropEditor } from './CropEditor'
import { FocusView } from './components/FocusView'
import { SettingsPage } from './components/SettingsPage'
import type { SettingsSection } from './components/SettingsPage'
import { speechSupported, useSpeechRecognition } from './speech'
import './styles.css'

type LocalTask = StoredTask
const STORAGE_KEY = 'lifeflow-web-tasks-v1'
const PLAN_KEY = 'lifeflow-web-plan-v1'
const TEMPLATE_KEY = 'lifeflow-web-templates-v1'
const THEME_KEY = 'lifeflow-web-theme-v1'
const API_URL = 'https://lifeflow-api.mosesbeck761988kdl.workers.dev'
const FOCUS_KEY = 'lifeflow-web-focus-v1'
const API_CONFIG_KEY = 'lifeflow-web-api-v1'
const BG_KEY = 'lifeflow-web-bg-v1'
const PLANNER_KEY = 'lifeflow-web-planner-v1'
const CARRYOVER_KEY = 'lifeflow-web-carryover-v1'
const REVIEW_KEY = 'lifeflow-web-review-v1'
const BLOCKS_KEY = 'lifeflow-web-blocks-v1'

const initialNow = new Date().toISOString()
const initialTasks: LocalTask[] = [
  { id: 'welcome', title: '试着加一件自己的事', status: 'inbox', importance: 'must', targetDurationMinutes: 30, splittable: false, done: false, createdAt: initialNow, updatedAt: initialNow },
]

function loadTasks(): LocalTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as LocalTask[]).map((task) => ({ ...task, createdAt: task.createdAt ?? new Date().toISOString(), updatedAt: task.updatedAt ?? new Date().toISOString(), done: task.done ?? task.status === 'completed' })) : initialTasks
  } catch {
    return initialTasks
  }
}

function loadPlan(): ExistingPlanBlock[] {
  try {
    const raw = localStorage.getItem(PLAN_KEY)
    return raw ? JSON.parse(raw) as ExistingPlanBlock[] : []
  } catch {
    return []
  }
}

function loadTemplates(): RecurringTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY)
    return raw ? JSON.parse(raw) as RecurringTemplate[] : []
  } catch {
    return []
  }
}

function reasonText(codes: string[]): string {
  if (codes.includes('ESTIMATE_REQUIRED')) return '还没估时间'
  if (codes.includes('PRESERVED_BUFFER')) return '需要动用缓冲'
  if (codes.includes('REST_PROTECTION')) return '会占用休息时间'
  if (codes.includes('DEADLINE_URGENT')) return '截止时间很近'
  return '今天时间不够'
}

function loadFocus(): FocusSession | null {
  try { const raw = localStorage.getItem(FOCUS_KEY); return raw ? JSON.parse(raw) as FocusSession : null } catch { return null }
}

// The local calendar date (YYYY-MM-DD). toISOString().slice(0, 10) would give
// the UTC date, which lags a day for every early-morning hour east of UTC.
function localDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function pad2(value: number): string { return String(value).padStart(2, '0') }

// ISO instant -> value for <input type="datetime-local"> in the local zone.
function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

interface BackgroundConfig { dataUrl: string; blur: number; dim: number; saturate: number }
const DEFAULT_BG: BackgroundConfig = { dataUrl: '', blur: 6, dim: 40, saturate: 100 }

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(trimmed) ? trimmed : null
}

function loadApiBaseUrl(): string {
  try {
    const raw = localStorage.getItem(API_CONFIG_KEY)
    if (!raw) return API_URL
    const parsed = JSON.parse(raw) as { baseUrl?: string }
    return typeof parsed.baseUrl === 'string' ? normalizeBaseUrl(parsed.baseUrl) ?? API_URL : API_URL
  } catch {
    return API_URL
  }
}

function clampParam(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
}

function loadBackground(): BackgroundConfig {
  try {
    const raw = localStorage.getItem(BG_KEY)
    if (!raw) return DEFAULT_BG
    const parsed = JSON.parse(raw) as Partial<BackgroundConfig>
    if (!parsed.dataUrl) return DEFAULT_BG
    return {
      dataUrl: parsed.dataUrl,
      blur: clampParam(parsed.blur, 0, 24, DEFAULT_BG.blur),
      dim: clampParam(parsed.dim, 0, 85, DEFAULT_BG.dim),
      saturate: clampParam(parsed.saturate, 0, 200, DEFAULT_BG.saturate),
    }
  } catch {
    return DEFAULT_BG
  }
}

function loadBlocks(): PlannerFixedBlock[] {
  try {
    const raw = localStorage.getItem(BLOCKS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PlannerFixedBlock[]
    return Array.isArray(parsed) ? parsed.filter((block) => typeof block.id === 'string' && typeof block.startAt === 'string' && typeof block.endAt === 'string') : []
  } catch {
    return []
  }
}

function ruleText(rule: RecurrenceRule): string {
  if (rule.kind === 'daily') return '每天'
  return '每周 ' + (rule.weekdays ?? []).map((day) => '日一二三四五六'[day]).join('、')
}

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read-failed'))
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      if (file.size <= 800 * 1024) { resolve(dataUrl); return }
      const image = new Image()
      image.onerror = () => reject(new Error('decode-failed'))
      image.onload = () => {
        const scale = Math.min(1, 1920 / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) { resolve(dataUrl); return }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

const TAGLINES: Array<{ text: string; from?: string }> = [
  { text: '今天，慢慢来。' },
  { text: '岁月本长，而忙者自促。', from: '《菜根谭》' },
  { text: '闲时要有吃紧的心思，忙处要有悠闲的趣味。', from: '《菜根谭》' },
  { text: '无事此静坐，一日似两日。', from: '苏轼' },
  { text: '行到水穷处，坐看云起时。', from: '王维' },
  { text: '物来顺应，未来不迎，当时不杂，既过不恋。', from: '曾国藩' },
  { text: '蜗牛角上争何事，石火光中寄此身。', from: '白居易' },
  { text: '人皆知有用之用，而莫知无用之用也。', from: '庄子' },
  { text: '纵浪大化中，不喜亦不惧。', from: '陶渊明' },
  { text: '能闲世人之所忙者，方能忙世人之所闲。', from: '张潮《幽梦影》' },
  { text: '我们总是在准备生活，却从未开始生活。', from: '塞涅卡' },
  { text: '在隆冬，我终于知道，我身上有一个不可战胜的夏天。', from: '加缪' },
  { text: '人类的一切不幸，都源于不能安静地待在自己的房间里。', from: '帕斯卡' },
]

interface PlannerConfig { start: string; end: string; bufferMinutes: number; restEnabled: boolean; restStart: string; restEnd: string }
const DEFAULT_PLANNER: PlannerConfig = { start: '08:00', end: '23:30', bufferMinutes: 45, restEnabled: true, restStart: '23:30', restEnd: '07:30' }

function validTime(value: unknown): string | null {
  return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value) ? value : null
}

function loadPlannerConfig(): PlannerConfig {  try {
    const raw = localStorage.getItem(PLANNER_KEY)
    if (!raw) return DEFAULT_PLANNER
    const parsed = JSON.parse(raw) as Partial<PlannerConfig>
    const buffer = typeof parsed.bufferMinutes === 'number' && Number.isFinite(parsed.bufferMinutes) ? Math.min(300, Math.max(0, Math.round(parsed.bufferMinutes))) : DEFAULT_PLANNER.bufferMinutes
    return {
      start: validTime(parsed.start) ?? DEFAULT_PLANNER.start,
      end: validTime(parsed.end) ?? DEFAULT_PLANNER.end,
      bufferMinutes: buffer,
      restEnabled: typeof parsed.restEnabled === 'boolean' ? parsed.restEnabled : DEFAULT_PLANNER.restEnabled,
      restStart: validTime(parsed.restStart) ?? DEFAULT_PLANNER.restStart,
      restEnd: validTime(parsed.restEnd) ?? DEFAULT_PLANNER.restEnd,
    }
  } catch {
    return DEFAULT_PLANNER
  }
}

// The service worker claims clients as soon as a new version is installed;
// surface that so the user can reload into the fresh build instead of
// silently staying on the old one until the next visit.
function useAppUpdate(): boolean {
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let hadController = Boolean(navigator.serviceWorker.controller)
    const onChange = () => {
      if (hadController) setUpdateReady(true)
      hadController = true
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])
  return updateReady
}

function App() {
  const [tasks, setTasks] = useState<LocalTask[]>(loadTasks)
  const [existingBlocks, setExistingBlocks] = useState<ExistingPlanBlock[]>(loadPlan)
  const [templates, setTemplates] = useState<RecurringTemplate[]>(loadTemplates)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [showAll, setShowAll] = useState(false)
  const [editingTask, setEditingTask] = useState<LocalTask | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editMinutes, setEditMinutes] = useState('')
  const [editPlace, setEditPlace] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editError, setEditError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [themeId, setThemeId] = useState<ThemeId>(() => getTheme(localStorage.getItem(THEME_KEY) ?? undefined).id)
  const theme = getTheme(themeId)
  const [importNotice, setImportNotice] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [repeatRule, setRepeatRule] = useState<RecurrenceRule | null>(null)
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [pinTime, setPinTime] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [focusSession, setFocusSession] = useState<FocusSession | null>(loadFocus)
  const [focusTick, setFocusTick] = useState(0)
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [aiReason, setAiReason] = useState('')
  const [aiOrder, setAiOrder] = useState<string[]>([])
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(now))
  const tagline = TAGLINES[Math.floor((Date.parse(`${localDate(now)}T00:00:00Z`) - Date.parse(`${localDate(now).slice(0, 4)}-01-01T00:00:00Z`)) / 86400000) % TAGLINES.length]
  const [apiBaseUrl, setApiBaseUrl] = useState(loadApiBaseUrl)
  const [apiDraft, setApiDraft] = useState(() => { const saved = loadApiBaseUrl(); return saved === API_URL ? '' : saved })
  const [apiNotice, setApiNotice] = useState('')
  const [apiNoticeTone, setApiNoticeTone] = useState<'info' | 'ok' | 'fail'>('info')
  const [apiTesting, setApiTesting] = useState(false)
  const [background, setBackground] = useState<BackgroundConfig>(loadBackground)
  const [bgNotice, setBgNotice] = useState('')
  const [cropOpen, setCropOpen] = useState(false)
  const bgInputRef = useRef<HTMLInputElement | null>(null)
  const [plannerConfig, setPlannerConfig] = useState<PlannerConfig>(loadPlannerConfig)
  const [preferredOrder, setPreferredOrder] = useState<string[] | null>(null)
  const [carryoverReviewed, setCarryoverReviewed] = useState(() => localStorage.getItem(CARRYOVER_KEY))
  const [carryoverKeeps, setCarryoverKeeps] = useState<Record<string, boolean>>({})
  const [reviewShown, setReviewShown] = useState(() => localStorage.getItem(REVIEW_KEY))
  const [blocks, setBlocks] = useState<PlannerFixedBlock[]>(loadBlocks)
  const [blocksOpen, setBlocksOpen] = useState(false)
  const [blockTitle, setBlockTitle] = useState('')
  const [blockStart, setBlockStart] = useState('09:00')
  const [blockEnd, setBlockEnd] = useState('10:00')
  const [blockError, setBlockError] = useState('')

  useEffect(() => {
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks))
  }, [blocks])
  const [editImportance, setEditImportance] = useState<Importance>('important')
  const [editSplittable, setEditSplittable] = useState(false)
  const [editDeadline, setEditDeadline] = useState('')
  const [voiceSupported] = useState(speechSupported)
  const voiceBaseRef = useRef('')
  const handleVoiceText = useCallback((chunk: string, finalText: string) => {
    setTitle(voiceBaseRef.current + finalText + chunk)
  }, [])
  const { listening: voiceListening, error: voiceError, start: startVoice, stop: stopVoice } = useSpeechRecognition(handleVoiceText)

  function toggleVoice() {
    if (voiceListening) { stopVoice(); return }
    voiceBaseRef.current = title
    startVoice()
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [createImportance, setCreateImportance] = useState<Importance>('important')
  const [createSplittable, setCreateSplittable] = useState(false)
  const [createDeadline, setCreateDeadline] = useState('')
  const [createPlace, setCreatePlace] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [createPinTime, setCreatePinTime] = useState('')
  const [createRepeatRule, setCreateRepeatRule] = useState<RecurrenceRule | null>(null)
  const [createRepeatDays, setCreateRepeatDays] = useState<number[]>([])
  const [createError, setCreateError] = useState('')

  function resetCreate() {
    setCreateOpen(false)
    setCreateImportance('important')
    setCreatePlace('')
    setCreateNotes('')
    setCreatePinTime('')
    setCreateError('')
    setCreateRepeatRule(null)
    setCreateRepeatDays([])
  }

  function addTaskDetailed() {
    const cleanTitle = title.trim()
    if (!cleanTitle) { setCreateError('先给它起个名字。'); return }
    if (createRepeatRule?.kind === 'weekly' && createRepeatDays.length === 0) { setCreateError('每周重复至少选一天。'); return }
    const parsed = Number.parseInt(minutes, 10)
    const draft: TaskDraft = {
      title: cleanTitle,
      importance: createImportance,
      splittable: createSplittable,
      deadlineAt: createDeadline ? new Date(createDeadline).toISOString() : undefined,
      place: createPlace || undefined,
      notes: createNotes || undefined,
      targetDurationMinutes: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
    }
    const created = createTask(draft, new Date().toISOString(), crypto.randomUUID())
    if (!created.task) return
    let task = created.task
    if (createPinTime) {
      const pinned = pinTask(task, createPinTime, localDate(new Date().toISOString()), 'Asia/Shanghai', new Date().toISOString())
      if (!pinned.task) { setCreateError('这个时间已经过去了，或者时长还没填。'); return }
      task = pinned.task
    }
    if (createRepeatRule) {
      const rule: RecurrenceRule = { kind: createRepeatRule.kind, weekdays: createRepeatRule.kind === 'weekly' ? createRepeatDays : undefined, startDate: localDate(new Date().toISOString()) }
      const template = createTemplate(crypto.randomUUID(), cleanTitle, rule, new Date().toISOString())
      template.importance = createImportance
      template.targetDurationMinutes = draft.targetDurationMinutes
      template.place = draft.place
      template.notes = draft.notes
      setTemplates((current) => [...current, template])
      task = { ...task, templateId: template.id, occurrenceDate: rule.startDate }
    }
    setTasks((current) => [...current, task])
    setTitle(''); setMinutes('30')
    resetCreate()
  }

  useEffect(() => {
    localStorage.setItem(PLANNER_KEY, JSON.stringify(plannerConfig))
  }, [plannerConfig])

  useEffect(() => {
    document.documentElement.classList.toggle('custom-bg-on', Boolean(background.dataUrl))
    try {
      if (!background.dataUrl) { localStorage.removeItem(BG_KEY); return }
      localStorage.setItem(BG_KEY, JSON.stringify(background))
    } catch {
      setBgNotice('图片太大，浏览器存不下，请换一张小一点的。')
    }
  }, [background])

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeId)
    const root = document.documentElement
    const tokenMap: Record<string, string> = {
      '--bg': theme.tokens.background,
      '--surface': theme.tokens.surface,
      '--text': theme.tokens.text,
      '--secondary': theme.tokens.secondary,
      '--tertiary': theme.tokens.tertiary,
      '--line': theme.tokens.line,
      '--accent': theme.tokens.accent,
      '--accent-soft': theme.tokens.accentSoft,
      '--success': theme.tokens.success,
      '--warning': theme.tokens.warning,
      '--error': theme.tokens.error,
      '--info': theme.tokens.info,
      '--radius': theme.tokens.radius,
      '--shadow': theme.tokens.shadow,
      '--font': theme.tokens.font,
      '--heading-weight': theme.tokens.headingWeight,
    }
    for (const [name, value] of Object.entries(tokenMap)) root.style.setProperty(name, value)
    document.body.dataset.theme = theme.id
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.tokens.background)
  }, [themeId, theme])

  useEffect(() => {
    if (!focusSession) { localStorage.removeItem(FOCUS_KEY); return }
    localStorage.setItem(FOCUS_KEY, JSON.stringify(focusSession))
    if (focusSession.state !== 'running') return
    const timer = window.setInterval(() => setFocusTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(timer)
  }, [focusSession])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])
  useEffect(() => {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates))
  }, [templates])

  useEffect(() => {
    const date = localDate(new Date().toISOString())
    const materialized = materializeOccurrences(templates, tasks, date, new Date().toISOString())
    if (materialized.length !== tasks.length) setTasks(materialized)
  }, [templates])

  const plannerInput = useMemo(() => ({
    now,
    settings: {
      timezone: 'Asia/Shanghai', planningDate: localDate(now),
      availabilityStartLocalTime: plannerConfig.start, availabilityEndLocalTime: plannerConfig.end, dailyBufferMinutes: plannerConfig.bufferMinutes,
      rest: { enabled: plannerConfig.restEnabled, startLocalTime: plannerConfig.restStart, endLocalTime: plannerConfig.restEnd },
    },
    tasks: tasks.filter((task) => !task.done), fixedBlocks: blocks,
    preferredOrder: preferredOrder ?? undefined,
  }), [tasks, now, preferredOrder, plannerConfig, blocks])

  const plan = useMemo(() => replanToday({ ...plannerInput, existingBlocks }), [plannerInput, existingBlocks])
  useEffect(() => {
    const snapshot = plan.planBlocks.map(({ taskId, startAt, endAt, source }) => ({ taskId, startAt, endAt, source }))
    localStorage.setItem(PLAN_KEY, JSON.stringify(snapshot))
    setExistingBlocks((previous) => JSON.stringify(previous) === JSON.stringify(snapshot) ? previous : snapshot)
  }, [plan.planBlocks])
  const scheduledIds = new Set(plan.planBlocks.map((block) => block.taskId))
  const visibleTasks = showAll ? tasks : tasks.filter((task) => scheduledIds.has(task.id) || task.done)
  const selectedTask = tasks.find((task) => task.id === selectedTaskId)
  const selectedBlock = plan.planBlocks.find((block) => block.taskId === selectedTaskId)
  const editingTemplate = editingTask?.templateId ? templates.find((item) => item.id === editingTask.templateId) : undefined
  const editingLive = editingTask ? (tasks.find((task) => task.id === editingTask.id) ?? editingTask) : null
  const timelineEntries = buildTimelineEntries(plan.planBlocks, plannerInput.settings)
  const changeCount = plan.changes.length
  const todayStr = localDate(now)
  const updateReady = useAppUpdate()
  const tomorrowStr = localDate(new Date(Date.parse(now) + 86400000).toISOString())
  const tomorrowTasks = tasks.filter((task) => !task.done && task.deferredUntil !== undefined && task.deferredUntil > todayStr)
  const timelineRows = [...timelineEntries, ...blocks.filter((block) => localDate(block.startAt) === todayStr).map((block) => ({ kind: 'block' as const, title: block.title, startAt: block.startAt, endAt: block.endAt }))].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
  const carryoverItems = carryoverReviewed === todayStr ? [] : selectCarryoverTasks(tasks, todayStr)
  const weekReview = completedThisWeek(tasks, now)
  const reviewDue = reviewShown !== weekKey(now) && weekReview.length > 0

  function finishCarryover() {
    const dropped = carryoverItems.filter((item) => !(carryoverKeeps[item.taskId] ?? true))
    if (dropped.length > 0) {
      const droppedIds = new Set(dropped.map((item) => item.taskId))
      setTasks((current) => current.map((task) => droppedIds.has(task.id) ? { ...task, status: 'skipped', updatedAt: new Date().toISOString() } : task))
    }
    localStorage.setItem(CARRYOVER_KEY, todayStr)
    setCarryoverReviewed(todayStr)
  }

  function skipCarryover() {
    localStorage.setItem(CARRYOVER_KEY, todayStr)
    setCarryoverReviewed(todayStr)
  }

  function finishReview() {
    const key = weekKey(now)
    localStorage.setItem(REVIEW_KEY, key)
    setReviewShown(key)
  }

  function setTaskFlag(id: string, patch: Partial<PlannerTask>) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task))
  }

  function addTask() {
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const parsed = Number.parseInt(minutes, 10)
    const draft: TaskDraft = {
      title: cleanTitle,
      importance: 'important',
      splittable: false,
      targetDurationMinutes: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
    }
    const created = createTask(draft, new Date().toISOString(), crypto.randomUUID())
    if (!created.task) return
    setTasks((current) => [...current, created.task!])
    setTitle('')
    setMinutes('30')
  }

  function toggleTask(id: string) {
    setTasks((current) => current.map((task) => task.id === id
      ? (task.done ? uncompleteTask(task, new Date().toISOString()) : completeTask(task, new Date().toISOString()))
      : task))
  }

  function removeTask(id: string) {
    const task = tasks.find((item) => item.id === id)
    if (!task) return
    const message = task.templateId
      ? `删除「${task.title}」？明天仍会生成新的一件；要彻底停止请先在编辑里停止重复。`
      : `删除「${task.title}」？`
    if (!window.confirm(message)) return
    setTasks((current) => deleteTask(current, id))
    if (selectedTaskId === id) setSelectedTaskId(null)
    if (editingTask?.id === id) setEditingTask(null)
    if (focusSession?.taskId === id) setFocusSession(null)
  }

  function openEditor(task: LocalTask) {
    setEditingTask(task)
    setEditTitle(task.title)
    setEditMinutes(task.targetDurationMinutes?.toString() ?? '')
    setEditPlace(task.place ?? '')
    setEditNotes(task.notes ?? '')
    setEditError('')
    setEditImportance(task.importance)
    setEditSplittable(task.splittable)
    setEditDeadline(toLocalInput(task.deadlineAt))
    setPinTime(task.lockedStartAt ? new Date(task.lockedStartAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '')
    setRepeatRule(null)
    setRepeatDays([])
  }

  function saveEdit() {
    if (!editingTask) return
    const rawMinutes = editMinutes.trim()
    const parsed = Number.parseInt(rawMinutes, 10)
    const draft: TaskDraft = {
      title: editTitle,
      importance: editImportance,
      splittable: editSplittable,
      deadlineAt: editDeadline ? new Date(editDeadline).toISOString() : undefined,
      place: editPlace,
      notes: editNotes,
      targetDurationMinutes: rawMinutes ? parsed : undefined,
    }
    const result = editTask(editingTask, draft, new Date().toISOString())
    if (!result.task) {
      setEditError(result.issues[0]?.code === 'TITLE_REQUIRED' ? '给它起个名字就好。' : '时间要填正整数，或者留空。')
      return
    }
    let saved = result.task!
    if (pinTime) {
      const pinned = pinTask(saved, pinTime, localDate(new Date().toISOString()), 'Asia/Shanghai', new Date().toISOString())
      if (!pinned.task) { setEditError('这个时间已经过去了，或者时长还没填。'); return }
      saved = pinned.task
    } else if (editingTask.lockedStartAt) {
      saved = unpinTask(saved, new Date().toISOString())
    }
    setTasks((current) => current.map((task) => task.id === editingTask.id ? saved : task))
    setEditingTask(null)
  }

  function startFocusFor(task: LocalTask) {
    if (!task.targetDurationMinutes) return
    setSelectedTaskId(task.id)
    setFocusSession(startFocus(task.id, task.targetDurationMinutes, new Date().toISOString()))
  }

  function toggleFocus() {
    if (!focusSession) return
    const now = new Date().toISOString()
    setFocusSession(focusSession.state === 'running' ? pauseFocus(focusSession, now) : resumeFocus(focusSession, now))
  }

  function endFocus() {
    if (!focusSession) return
    setFocusSession(null)
  }

  async function askAiOrder() {
    const candidates = tasks.filter((task) => !task.done && task.targetDurationMinutes !== undefined).slice(0, 20).map((task) => ({ id: task.id, title: task.title, durationMinutes: task.targetDurationMinutes!, importance: task.importance }))
    if (candidates.length === 0) return
    setAiState('loading'); setAiReason('')
    try {
      const response = await fetch(`${apiBaseUrl}/v1/ai/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: candidates, context: { now, windowEndLocalTime: plannerConfig.end } }) })
      const result = await response.json() as { ok?: boolean; order?: string[]; reason?: string }
      if (!response.ok || !result.ok || !result.order || !result.reason) throw new Error('AI_UNAVAILABLE')
      setAiOrder(result.order); setAiReason(result.reason); setAiState('ready')
    } catch {
      setAiState('error'); setAiReason('AI 暂时不可用，本地计划没有改变。')
    }
  }

  function dismissAiAdvice() {
    setAiState('idle'); setAiOrder([]); setAiReason('')
  }

  async function saveApiConfig() {
    const trimmed = apiDraft.trim()
    if (!trimmed) {
      localStorage.removeItem(API_CONFIG_KEY)
      setApiBaseUrl(API_URL)
      setApiDraft('')
      setApiNoticeTone('info'); setApiNotice('已恢复默认服务地址。')
      return
    }
    const normalized = normalizeBaseUrl(trimmed)
    if (!normalized) { setApiNoticeTone('fail'); setApiNotice('地址要以 http:// 或 https:// 开头。'); return }
    localStorage.setItem(API_CONFIG_KEY, JSON.stringify({ baseUrl: normalized }))
    setApiBaseUrl(normalized)
    setApiDraft(normalized)
    setApiNoticeTone('ok'); setApiNotice('已保存，可以用「测试连接」确认服务在线。')
  }

  async function testApiConnection() {
    setApiTesting(true)
    setApiNoticeTone('info'); setApiNotice('正在连接……')
    const startedAt = Date.now()
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 5000)
      const response = await fetch(`${apiBaseUrl}/health`, { signal: controller.signal })
      window.clearTimeout(timer)
      if (response.ok) { setApiNoticeTone('ok'); setApiNotice(`连接正常（${Date.now() - startedAt} ms）。`) }
      else { setApiNoticeTone('fail'); setApiNotice(`服务返回了 ${response.status}。`) }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      setApiNoticeTone('fail')
      setApiNotice(aborted ? '5 秒内没有响应。' : '无法连接，检查地址或服务是否在线。')
    } finally {
      setApiTesting(false)
    }
  }

  function handleBackgroundFile(file: File) {
    setBgNotice('')
    if (!file.type.startsWith('image/')) { setBgNotice('请选择图片文件。'); return }
    readImageFile(file)
      .then((dataUrl) => {
        if (dataUrl.length > Math.round(2.5 * 1024 * 1024)) { setBgNotice('图片太大，浏览器存不下，请换一张小一点的。'); return }
        setBackground((current) => ({ ...current, dataUrl }))
        setCropOpen(true)
      })
      .catch(() => setBgNotice('这张图片读取失败，请换一张试试。'))
  }

  function updateBackground(patch: Partial<BackgroundConfig>) {
    setBackground((current) => ({ ...current, ...patch }))
  }

  function resetBackgroundParams() {
    setBackground((current) => ({ ...current, blur: DEFAULT_BG.blur, dim: DEFAULT_BG.dim, saturate: DEFAULT_BG.saturate }))
  }

  function updatePlanner(patch: Partial<PlannerConfig>) {
    setPlannerConfig((current) => ({ ...current, ...patch }))
  }

  function addBlock() {
    const cleanTitle = blockTitle.trim()
    if (!cleanTitle) { setBlockError('给这段日程起个名字。'); return }
    const start = /^([01]\d|2[0-3]):[0-5]\d$/.test(blockStart) ? blockStart : null
    const end = /^([01]\d|2[0-3]):[0-5]\d$/.test(blockEnd) ? blockEnd : null
    if (!start || !end) { setBlockError('开始和结束都要填时间。'); return }
    const day = localDate(now)
    const startAt = new Date(`${day}T${start}:00`).toISOString()
    const endAt = new Date(`${day}T${end}:00`).toISOString()
    if (Date.parse(endAt) <= Date.parse(startAt)) { setBlockError('结束要比开始晚。'); return }
    setBlocks((current) => [...current, { id: crypto.randomUUID(), title: cleanTitle, startAt, endAt, strength: 'hard', movable: false }])
    setBlockTitle(''); setBlockError('')
  }

  function removeBackgroundImage() {
    setBackground(DEFAULT_BG)
    setCropOpen(false)
    setBgNotice('')
  }

  function exportData() {
    const blob = new Blob([buildExport(tasks, templates)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `lifeflow-${localDate(new Date().toISOString())}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function importData(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseImport(String(reader.result ?? ''))
      if (!parsed.ok) { setImportNotice('这个文件不是可用的 LifeFlow 数据。'); return }
      const merged = mergeImportedTasks(tasks, parsed.tasks)
      setTasks(merged.tasks)
      setTemplates((current) => {
        const byId = new Map(current.map((template) => [template.id, template]))
        for (const template of parsed.templates) {
          const existing = byId.get(template.id)
          if (!existing || Date.parse(template.updatedAt) > Date.parse(existing.updatedAt)) byId.set(template.id, template)
        }
        return [...byId.values()]
      })
      setImportNotice(`已导入：新增 ${merged.added} 件，更新 ${merged.replaced} 件；本机保留 ${merged.keptLocal} 件。`)
    }
    reader.onerror = () => setImportNotice('读取文件失败，请重试。')
    reader.readAsText(file)
  }

  function deleteAllData() {
    if (!window.confirm('确定删除 LifeFlow 保存的全部本地数据吗？此操作不可撤销。')) return
    for (const key of [STORAGE_KEY, PLAN_KEY, TEMPLATE_KEY, FOCUS_KEY, THEME_KEY, API_CONFIG_KEY, BG_KEY, PLANNER_KEY, CARRYOVER_KEY, REVIEW_KEY, BLOCKS_KEY]) localStorage.removeItem(key)
    setTasks([])
    setExistingBlocks([])
    setTemplates([])
    setFocusSession(null)
    setThemeId(defaultTheme.id)
    setImportNotice('')
    setAiState('idle'); setAiOrder([]); setAiReason('')
    setApiBaseUrl(API_URL)
    setApiDraft('')
    setApiNotice('')
    setBackground(DEFAULT_BG)
    setBgNotice('')
    setCropOpen(false)
    setPlannerConfig(DEFAULT_PLANNER)
    setPreferredOrder(null)
    setBlocks([])
    setSettingsOpen(false)
  }

  function toggleRepeatDay(day: number) {
    setRepeatDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])
  }

  function saveRepeat() {
    if (!editingTask || (repeatRule?.kind === 'weekly' && repeatDays.length === 0)) return
    const kind = repeatRule?.kind ?? 'daily'
    const rule: RecurrenceRule = { kind, weekdays: kind === 'weekly' ? repeatDays : undefined, startDate: localDate(new Date().toISOString()) }
    const template = createTemplate(crypto.randomUUID(), editingTask.title, rule, new Date().toISOString())
    template.importance = editingTask.importance; template.targetDurationMinutes = editingTask.targetDurationMinutes; template.splittable = editingTask.splittable; template.notes = editingTask.notes; template.place = editingTask.place
    setTemplates((current) => [...current, template])
    setTasks((current) => current.map((task) => task.id === editingTask.id ? { ...task, templateId: template.id, occurrenceDate: rule.startDate } : task))
    setEditingTask(null); setRepeatRule(null); setRepeatDays([])
  }

  function stopRepeat(task: LocalTask) {
    if (!task.templateId) return
    setTemplates((current) => current.map((item) => item.id === task.templateId ? { ...item, paused: true } : item))
  }

  function resumeRepeat(task: LocalTask) {
    if (!task.templateId) return
    setTemplates((current) => current.map((item) => item.id === task.templateId ? { ...item, paused: false } : item))
  }

  function deleteRepeat(task: LocalTask) {
    if (!task.templateId) return
    if (!window.confirm('停止这条重复规则？已生成的任务会保留，之后不再生成新的。')) return
    const templateId = task.templateId
    setTemplates((current) => current.filter((item) => item.id !== templateId))
    const unlink = (item: LocalTask) => item.templateId === templateId ? { ...item, templateId: undefined, occurrenceDate: undefined } : item
    setTasks((current) => current.map(unlink))
    setEditingTask((current) => current ? unlink(current) : current)
  }

  const backgroundLayers = background.dataUrl ? (
    <>
      <div className="custom-bg-image" aria-hidden="true" style={{ backgroundImage: `url(${background.dataUrl})`, filter: `blur(${background.blur}px) saturate(${background.saturate}%)` }} />
      <div className="custom-bg-scrim" aria-hidden="true" style={{ opacity: background.dim / 100 }} />
    </>
  ) : null

  if (focusSession) {
    const focusTask = tasks.find((task) => task.id === focusSession.taskId)
    const remaining = focusRemainingSeconds(focusSession, new Date().toISOString())
    return (
      <>
        {backgroundLayers}
        <FocusView session={focusSession} taskTitle={focusTask?.title ?? '一件事'} remaining={remaining} onPauseToggle={toggleFocus} onEnd={endFocus} />
      </>
    )
  }

  const appearanceSection = <section className="settings-section" aria-label="外观设置"><p className="label">APPEARANCE / 外观</p><h2>视觉皮肤</h2><p className="settings-copy">皮肤只改变表现方式，不改变任务、计划规则或数据归属。</p><div className="theme-picker">{themeIds.map((id) => { const option = getTheme(id); return <button className={`theme-option ${themeId === id ? 'selected' : ''}`} type="button" key={id} onClick={() => setThemeId(id)}><span className="theme-swatch" style={{ background: option.tokens.background, borderColor: option.tokens.accent }} /><span><strong>{option.name}</strong><small>{option.description}</small></span></button> })}</div><div className="bg-picker"><p className="label">背景图</p><p className="settings-copy">用一张自己的图片做页面背景。上传后拖动裁剪框决定画面，缩放滑杆控制取景范围；模糊和遮罩帮文字保持可读。它只影响外观，不影响任务数据。</p>{background.dataUrl && <div className="bg-preview" style={{ backgroundImage: `url(${background.dataUrl})` }} aria-hidden="true" />}<input ref={bgInputRef} className="file-input" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleBackgroundFile(file); event.currentTarget.value = '' }} /><div className="settings-actions"><button className="secondary-button" type="button" onClick={() => bgInputRef.current?.click()}>选择图片</button>{background.dataUrl && <button className="secondary-button" type="button" onClick={() => setCropOpen(true)}>裁剪画面</button>}{background.dataUrl && <button className="secondary-button" type="button" onClick={resetBackgroundParams}>恢复默认参数</button>}{background.dataUrl && <button className="secondary-button" type="button" onClick={removeBackgroundImage}>移除背景图</button>}</div>{cropOpen && background.dataUrl && <CropEditor dataUrl={background.dataUrl} aspect={window.innerWidth / window.innerHeight} onApply={(cropped) => { setBackground((current) => ({ ...current, dataUrl: cropped })); setCropOpen(false) }} onCancel={() => setCropOpen(false)} />}{background.dataUrl && !cropOpen && <div className="bg-controls"><label>模糊<input type="range" min={0} max={24} value={background.blur} onChange={(event) => updateBackground({ blur: Number(event.target.value) })} /><span>{background.blur}px</span></label><label>遮罩<input type="range" min={0} max={85} value={background.dim} onChange={(event) => updateBackground({ dim: Number(event.target.value) })} /><span>{background.dim}%</span></label><label>饱和度<input type="range" min={0} max={200} value={background.saturate} onChange={(event) => updateBackground({ saturate: Number(event.target.value) })} /><span>{background.saturate}%</span></label></div>}{bgNotice && <p className="import-notice">{bgNotice}</p>}</div></section>
  if (settingsOpen) return (
    <>
      {backgroundLayers}
      <SettingsPage
        section={settingsSection}
        onSectionChange={setSettingsSection}
        onBack={() => setSettingsOpen(false)}
        appearanceSection={appearanceSection}
        planner={plannerConfig}
        onPlannerChange={updatePlanner}
        templates={templates}
        onTemplatesChange={setTemplates}
        apiDraft={apiDraft}
        onApiDraftChange={setApiDraft}
        apiNotice={apiNotice}
        apiNoticeTone={apiNoticeTone}
        apiTesting={apiTesting}
        defaultApiUrl={API_URL}
        onApiSave={saveApiConfig}
        onApiTest={testApiConnection}
        importNotice={importNotice}
        importInputRef={importInputRef}
        onExport={exportData}
        onImport={importData}
        onDeleteAll={deleteAllData}
      />
    </>
  )

  return (
    <>
      {backgroundLayers}
      {updateReady && <div className="update-toast"><span>LifeFlow 更新好了，刷新一下就能用上新版。</span><button className="secondary-button" type="button" onClick={() => location.reload()}>刷新</button></div>}
      <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">LIFEFLOW</p>
          <div className="tagline-block">
            <h1>{tagline.text}</h1>
            {tagline.from && <span className="tagline-from">——{tagline.from}</span>}
          </div>
          <p className="date">{today}</p>
        </div>
        <div className="header-actions">
          <label className="theme-control"><span>皮肤</span><select aria-label="切换皮肤" value={themeId} onChange={(event) => setThemeId(event.target.value as ThemeId)}>{themeIds.map((id) => <option value={id} key={id}>{getTheme(id).name}</option>)}</select></label>
          <button className="ghost-button" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? '只看今天' : '全部任务'}</button>
          <button className="ghost-button" type="button" onClick={() => setSettingsOpen((value) => !value)}>设置</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="导航与状态">
          <div className="side-block"><p className="side-title">现在</p><div className="side-line"><span>未完成</span><span>{tasks.filter((task) => !task.done).length}</span></div><div className="side-line"><span>已安排</span><span>{plan.planBlocks.length}</span></div></div>
          <div className="side-block"><p className="side-title">库存</p><div className="side-line"><span>未排入</span><span>{plan.unscheduledTasks.length}</span></div><div className="side-line"><span>已完成</span><span>{tasks.filter((task) => task.done).length}</span></div></div>
        </aside>
        <section className="timeline-area">
          <section className="focus-line" aria-label="当前进行"><span className="focus-dot" />{plan.planBlocks.length ? '计划已经准备好了' : '先放下一件事'}<span className="muted">{changeCount ? `计划变了 ${changeCount} 处` : ''}</span></section>

      {carryoverItems.length > 0 && <section className="edit-card carryover-card" aria-label="隔夜整理">
        <div className="edit-heading"><p className="label">CARRYOVER / 隔夜整理</p></div>
        <p className="settings-copy">昨天留下来的事，还想继续吗？勾着的留下，去掉的轻轻放下，不记任何账。</p>
        <div className="carryover-list">{carryoverItems.map((item) => <label className="carryover-row" key={item.taskId}><input type="checkbox" checked={carryoverKeeps[item.taskId] ?? true} onChange={(event) => setCarryoverKeeps((current) => ({ ...current, [item.taskId]: event.target.checked }))} /><span className="carryover-title">{item.title}</span>{item.minutes !== undefined && <small>{item.minutes} 分钟</small>}</label>)}</div>
        <div className="settings-actions"><button className="secondary-button" type="button" onClick={finishCarryover}>好</button><button className="link-button" type="button" onClick={skipCarryover}>先不管</button></div>
      </section>}

      <section className="timeline-card" aria-label="今日时间线">
        <div className="section-heading">
          <div><p className="label">今日时间线</p><h2>{showAll ? '全部任务' : '接下来'}</h2></div>
          <span className="muted">{changeCount ? `计划变了 ${changeCount} 处` : `${plan.planBlocks.length} 件已安排`}</span>
        </div>
        <div className="timeline">
          {visibleTasks.length === 0 && <p className="empty">还没有安排。把现实中的事情写在下面。</p>}
          {timelineRows.map((entry) => {
            if (entry.kind === 'block') return <div className="special-row block" key={`block-${entry.startAt}-${entry.title}`}><span className="row-time">{new Date(entry.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span><span className="row-rail" aria-hidden="true"><i className="rail-dot is-block" /></span><span className="special-copy"><span>{entry.title}</span><small>固定日程，任务不会排进来</small></span></div>
            if (entry.kind !== 'task') return <div className={`special-row ${entry.kind}`} key={`${entry.kind}-${entry.startAt}`}><span className="row-time">{new Date(entry.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span><span className="row-rail" aria-hidden="true"><i className="rail-dot" /></span><span className="special-copy"><span>{entry.title}</span><small>{entry.kind === 'buffer' ? '为变化留出空间' : '这段时间本身就是计划的一部分'}</small></span></div>
            const task = tasks.find((candidate) => candidate.id === entry.taskId)
            if (!task) return null
            const isCurrent = !task.done && Date.parse(entry.startAt) <= Date.parse(now) && Date.parse(now) < Date.parse(entry.endAt)
            return <div className={`task-row ${task.done ? 'is-done' : ''} ${selectedTaskId === task.id ? 'is-selected' : ''} ${isCurrent ? 'is-current' : ''}`} key={task.id}>
              <span className="row-time">{new Date(entry.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="row-rail" aria-hidden="true"><i className={`rail-dot ${isCurrent ? 'is-now' : ''}`} /></span>
              <button className="task-main" type="button" onClick={() => { setSelectedTaskId(task.id); toggleTask(task.id) }}><span className="task-check" aria-hidden="true">{task.done ? '✓' : ''}</span><span className="task-copy"><span className="task-title">{task.title}{task.importance === 'must' && <span className="importance-badge">必须做</span>}</span><span className="task-place">{task.targetDurationMinutes ? `${task.targetDurationMinutes} 分钟` : '还没估时间'}{task.place ? ` · ${task.place}` : ''}</span>{task.notes && <span className="task-notes">{task.notes}</span>}</span></button>
              <span className="task-side">{isCurrent && <span className="now-chip">现在</span>}<small>{task.done ? '已完成' : entry.source === 'manualLock' ? '已锁定' : '已安排'}</small></span>
              <button className="edit-button" type="button" onClick={() => openEditor(task)}>改</button>
            </div>
          })}
          {showAll && (plan.unscheduledTasks.length > 0 || tomorrowTasks.length > 0) && <div className="deferred-list">
            <p className="label">今天没排进去</p>
            {plan.unscheduledTasks.map((item) => {
              const task = tasks.find((candidate) => candidate.id === item.taskId)
              const decidable = item.reasonCodes.includes('PRESERVED_BUFFER') || item.reasonCodes.includes('REST_PROTECTION') || item.reasonCodes.includes('INSUFFICIENT_TIME')
              return task && <div className="deferred-row decision-row" key={item.taskId}>
                <span>{task.title}</span>
                {decidable ? <span className="decision-actions"><small>{reasonText(item.reasonCodes)}</small><button className="link-button" type="button" onClick={() => openEditor(task)}>改</button><button className="link-button" type="button" onClick={() => setTaskFlag(item.taskId, { forceToday: true })}>放在今天</button><button className="link-button" type="button" onClick={() => setTaskFlag(item.taskId, { deferredUntil: tomorrowStr })}>放到明天</button><button className="link-button" type="button" onClick={() => { setSettingsSection('planning'); setSettingsOpen(true) }}>调整时段</button></span> : <small>{reasonText(item.reasonCodes)}</small>}
              </div>
            })}
            {tomorrowTasks.length > 0 && <div className="tomorrow-group"><p className="label">明天见</p>{tomorrowTasks.map((task) => <div className="deferred-row" key={task.id}><span>{task.title}</span><span className="decision-actions"><small>明天自动排入</small><button className="link-button" type="button" onClick={() => setTaskFlag(task.id, { deferredUntil: undefined })}>留在今天</button></span></div>)}</div>}
          </div>}
        </div>
      </section>

      <section className="capture" aria-label="快速添加">
        <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') (createOpen ? addTaskDetailed() : addTask()) }} placeholder="加一件事" aria-label="加一件事" />
        <input className="minutes-input" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="预计分钟" inputMode="numeric" />
        <span className="minutes-label">分</span>
        {voiceSupported && <button className={`mic-button ${voiceListening ? 'listening' : ''}`} type="button" aria-label={voiceListening ? '停止听写' : '语音输入'} title={voiceListening ? '停止听写' : '语音输入'} onClick={toggleVoice}>🎙</button>}
        <button className="add-button" type="button" onClick={() => (createOpen ? addTaskDetailed() : addTask())}>加</button>
      </section>
      {voiceError && <p className="voice-error">{voiceError === 'not-allowed' ? '需要麦克风权限才能听写。' : voiceError === 'network' ? '语音服务暂时不可用，检查网络后重试。' : '没听清，再试一次。'}</p>}
      {!createOpen && <button className="link-button expand-toggle" type="button" onClick={() => setCreateOpen(true)}>展开详细设置，顺便定好重要性和时间 ▾</button>}
      {!blocksOpen && <button className="link-button expand-toggle" type="button" onClick={() => setBlocksOpen(true)}>加一段固定日程（会议、课程这类挪不动的时间） ▾</button>}
      {blocksOpen && <section className="edit-card create-card" aria-label="固定日程">
        <div className="edit-heading"><p className="label">固定日程</p><button className="link-button" type="button" onClick={() => setBlocksOpen(false)}>收起</button></div>
        <p className="settings-copy">会议、课程这类挪不动的时间。排程会把它们挖掉，任务不会排进这些时段。</p>
        <div className="edit-grid"><input value={blockTitle} onChange={(event) => setBlockTitle(event.target.value)} placeholder="标题，比如：组会" aria-label="日程标题" /><div className="block-times"><input type="time" value={blockStart} onChange={(event) => setBlockStart(event.target.value)} aria-label="日程开始" /><input type="time" value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} aria-label="日程结束" /></div></div>
        {blockError && <p className="error-text">{blockError}</p>}
        <div className="settings-actions"><button className="add-button" type="button" onClick={addBlock}>添加日程</button></div>
        {blocks.filter((block) => localDate(block.startAt) === todayStr).map((block) => <div className="deferred-row" key={block.id}><span>{block.title}</span><span className="decision-actions"><small>{new Date(block.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} — {new Date(block.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small><button className="link-button" type="button" onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))}>删除</button></span></div>)}
      </section>}
      {createOpen && <section className="edit-card create-card" aria-label="新任务详细设置">
        <div className="edit-heading"><p className="label">新任务 · 详细设置</p><button className="link-button" type="button" onClick={resetCreate}>收起</button></div>
        <div className="repeat-panel"><span className="edit-hint">重要性</span>{([['must', '必须做'], ['important', '重要'], ['want', '想做']] as Array<[Importance, string]>).map(([value, label]) => <button className={createImportance === value ? 'choice active' : 'choice'} type="button" key={value} onClick={() => setCreateImportance(value)}>{label}</button>)}</div>
        <div className="repeat-panel"><span className="edit-hint">拆分</span><button className={createSplittable ? 'choice active' : 'choice'} type="button" onClick={() => setCreateSplittable((value) => !value)}>{createSplittable ? '可以切小块' : '不切分'}</button><span className="edit-hint">超过 50 分钟的长任务自动按 25 分钟切块</span></div>
        <div className="edit-grid"><input type="datetime-local" value={createDeadline} onChange={(event) => setCreateDeadline(event.target.value)} aria-label="截止时间" /><span className="edit-hint">截止时间，可选</span></div>
        <div className="edit-grid"><input value={createPlace} onChange={(event) => setCreatePlace(event.target.value)} placeholder="在哪里" aria-label="在哪里" /><input type="time" value={createPinTime} onChange={(event) => setCreatePinTime(event.target.value)} aria-label="钉在几点" /></div>
        <span className="edit-hint pin-hint">钉在几点，留空表示自动安排</span>
        <textarea value={createNotes} onChange={(event) => setCreateNotes(event.target.value)} placeholder="描述" rows={2} aria-label="描述" />
        <div className="repeat-panel">
          <span className="edit-hint">重复</span>
          <button className={createRepeatRule?.kind === 'daily' ? 'choice active' : 'choice'} type="button" onClick={() => setCreateRepeatRule({ kind: 'daily', startDate: localDate(new Date().toISOString()) })}>每天</button>
          <button className={createRepeatRule?.kind === 'weekly' ? 'choice active' : 'choice'} type="button" onClick={() => setCreateRepeatRule({ kind: 'weekly', weekdays: createRepeatDays, startDate: localDate(new Date().toISOString()) })}>每周</button>
          {createRepeatRule?.kind === 'weekly' && <div className="weekday-list">{['日', '一', '二', '三', '四', '五', '六'].map((label, index) => <button className={createRepeatDays.includes(index) ? 'day active' : 'day'} type="button" key={label} onClick={() => setCreateRepeatDays((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])}>{label}</button>)}</div>}
          {createRepeatRule && <span className="edit-hint">会创建一条重复规则，今天生成第一件</span>}
        </div>
        {createError && <p className="error-text">{createError}</p>}
      </section>}

      {editingTask && <section className="edit-card" aria-label="编辑任务">
        <div className="edit-heading"><p className="label">编辑任务</p><span className="edit-heading-actions"><button className="link-button danger-link" type="button" onClick={() => removeTask(editingTask.id)}>删除这件事</button><button className="link-button" type="button" onClick={() => setEditingTask(null)}>取消</button></span></div>
        <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="要做什么？" />
        <div className="edit-grid"><input value={editMinutes} onChange={(event) => setEditMinutes(event.target.value)} placeholder="分钟" inputMode="numeric" /><input value={editPlace} onChange={(event) => setEditPlace(event.target.value)} placeholder="在哪里" /></div>
        <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="描述" rows={3} />
        <div className="repeat-panel"><span className="edit-hint">重要性</span>{([['must', '必须做'], ['important', '重要'], ['want', '想做']] as Array<[Importance, string]>).map(([value, label]) => <button className={editImportance === value ? 'choice active' : 'choice'} type="button" key={value} onClick={() => setEditImportance(value)}>{label}</button>)}</div>
        <div className="repeat-panel"><span className="edit-hint">拆分</span><button className={editSplittable ? 'choice active' : 'choice'} type="button" onClick={() => setEditSplittable((value) => !value)}>{editSplittable ? '可以切小块' : '不切分'}</button><span className="edit-hint">超过 50 分钟的长任务自动按 25 分钟切块</span></div>
        <div className="edit-grid"><input type="datetime-local" value={editDeadline} onChange={(event) => setEditDeadline(event.target.value)} aria-label="截止时间" /><span className="edit-hint">截止时间，可选</span></div>
        <div className="edit-grid"><input type="time" value={pinTime} onChange={(event) => setPinTime(event.target.value)} /><span className="edit-hint">留空表示自动安排</span></div>
        <div className="repeat-panel">
          <span className="edit-hint">重复</span>
          <button className={repeatRule?.kind === 'daily' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeatRule({ kind: 'daily', startDate: localDate(new Date().toISOString()) })}>每天</button>
          <button className={repeatRule?.kind === 'weekly' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeatRule({ kind: 'weekly', weekdays: repeatDays, startDate: localDate(new Date().toISOString()) })}>每周</button>
          {repeatRule?.kind === 'weekly' && <div className="weekday-list">{['日', '一', '二', '三', '四', '五', '六'].map((label, index) => <button className={repeatDays.includes(index) ? 'day active' : 'day'} type="button" key={label} onClick={() => toggleRepeatDay(index)}>{label}</button>)}</div>}
          {repeatRule && <button className="secondary-button" type="button" onClick={saveRepeat}>保存重复规则</button>}
          {editingTask.templateId && !editingTemplate?.paused && <button className="link-button" type="button" onClick={() => stopRepeat(editingTask)}>暂停重复</button>}
          {editingTask.templateId && editingTemplate?.paused && <button className="link-button" type="button" onClick={() => resumeRepeat(editingTask)}>恢复重复</button>}
          {editingTask.templateId && <button className="link-button" type="button" onClick={() => deleteRepeat(editingTask)}>不再重复</button>}
        </div>
        {(editingLive?.deferredUntil || editingLive?.forceToday) && <div className="repeat-panel">
          {editingLive.deferredUntil && <><span className="edit-hint">已放到 {editingLive.deferredUntil}，那天自动排入</span><button className="link-button" type="button" onClick={() => setTaskFlag(editingLive.id, { deferredUntil: undefined })}>留在今天</button></>}
          {editingLive.forceToday && <><span className="edit-hint">已让它留在今天（可占用休息）</span><button className="link-button" type="button" onClick={() => setTaskFlag(editingLive.id, { forceToday: undefined })}>恢复自动安排</button></>}
        </div>}
        {editError && <p className="error-text">{editError}</p>}
        <button className="add-button save-edit" type="button" onClick={saveEdit}>保存修改</button>
      </section>}

      <section className="edit-card ai-card" aria-label="AI 建议顺序">
        <div className="edit-heading"><p className="label">AI 建议 · 可选</p>{aiState === 'ready' && <button className="link-button" type="button" onClick={dismissAiAdvice}>收起</button>}</div>
        {preferredOrder && <div className="ai-adopted"><p className="detail-empty">已按建议顺序重排，休息和缓冲仍由规则保护。</p><button className="link-button" type="button" onClick={() => setPreferredOrder(null)}>恢复规则排序</button></div>}
        {aiState === 'idle' && <><p className="settings-copy">让 AI 根据重要性和今天剩下的时间给任务排个顺序。它只提建议，采纳与否由你决定。</p><button className="secondary-button" type="button" onClick={askAiOrder}>查看建议顺序</button></>}
        {aiState === 'loading' && <p className="detail-empty">正在整理顺序……</p>}
        {aiState === 'error' && <p className="error-text">{aiReason}</p>}
        {aiState === 'ready' && <><p className="detail-empty">{aiReason}</p><p className="ai-order">{aiOrder.map((id) => tasks.find((task) => task.id === id)?.title).filter(Boolean).join(' → ')}</p><div className="settings-actions"><button className="secondary-button" type="button" onClick={() => { setPreferredOrder(aiOrder); dismissAiAdvice() }}>就这么排</button><button className="link-button" type="button" onClick={dismissAiAdvice}>不用</button></div><small>采纳后本地规则仍负责具体时间安排，休息和缓冲照常保护。</small></>}
      </section>

      {reviewDue && <section className="edit-card review-card" aria-label="每周回顾">
        <p className="label">WEEKLY / 每周回顾</p>
        <h2>这一周，你做过这些</h2>
        <p className="settings-copy">不算完成率，不排名次。做过，就算数。</p>
        <ul className="review-list">{weekReview.map((item) => <li key={item.title}>{item.title}{item.count > 1 ? ` ×${item.count}` : ''}</li>)}</ul>
        <button className="secondary-button" type="button" onClick={finishReview}>好</button>
      </section>}

      <section className="quiet-note"><span className="note-mark">✦</span><p>排不下的时候，我会告诉你原因。<br />不会偷偷吃掉你的休息。</p></section>
      <footer><span>本地保存 · 不需要账号</span><button className="link-button" type="button" onClick={() => setShowAll(true)}>查看全部任务</button></footer>
        </section>
        <aside className="detail-panel" aria-label="任务详情">
          {selectedTask ? <>
            <p className="label">任务详情</p>
            <h2 className="detail-title">{selectedTask.title}</h2>
            {selectedBlock && <p className="detail-time">{new Date(selectedBlock.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} — {new Date(selectedBlock.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>}
            <p className="detail-meta">{selectedTask.targetDurationMinutes ? `${selectedTask.targetDurationMinutes} 分钟` : '还没估时间'}{selectedTask.place ? ` · ${selectedTask.place}` : ''}</p>
            {selectedTask.notes && <p className="detail-empty">{selectedTask.notes}</p>}
            <div className="detail-rule" />
            <p className="label">为什么在这里</p>
            <ul className="detail-list"><li>{selectedTask.importance === 'must' ? '你标记了今天需要完成' : selectedTask.importance === 'want' ? '你想做的事，排在重要事情之后' : '按当前可用时间安排'}</li><li>{selectedTask.targetDurationMinutes ? `预计需要 ${selectedTask.targetDurationMinutes} 分钟` : '需要先补充预计时间'}</li>{selectedBlock?.source === 'manualLock' && <li>这是你手动锁定的时间</li>}</ul>
            <button className="edit-button" type="button" onClick={() => openEditor(selectedTask)}>编辑这件事</button>
            <div className="focus-panel"><p className="label">专注</p><button className="secondary-button" type="button" onClick={() => startFocusFor(selectedTask)}>开始专注</button></div>
          </> : <p className="detail-empty">选择一件事，查看它为什么出现在这里。</p>}
        </aside>
      </div>
    </main>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

