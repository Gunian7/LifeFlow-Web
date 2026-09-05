import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ExistingPlanBlock, Importance, PlannerFixedBlock, PlannerTask, StoredTask, TaskDraft, RecurrenceRule, RecurringTemplate, ThemeId } from '../../../packages/core/src'
import { buildBriefingFacts, buildExport, buildTimelineEntries, completedThisWeek, createTask, createTemplate, defaultTheme, deleteTask, editTask, getTheme, materializeOccurrences, mergeImportedTasks, parseImport, pinTask, replanToday, selectCarryoverTasks, weekKey, completeTask, uncompleteTask, unpinTask, themeIds } from '../../../packages/core/src'
import type { FocusSession } from '../../../packages/core/src/focus'
import { focusRemainingSeconds, pauseFocus, resumeFocus, startFocus } from '../../../packages/core/src/focus'
import { CropEditor } from './CropEditor'
import { AiCard } from './components/AiCard'
import { BlocksCard } from './components/BlocksCard'
import { BriefingCard } from './components/BriefingCard'
import { CaptureCard } from './components/CaptureCard'
import { EditCard } from './components/EditCard'
import { FocusView } from './components/FocusView'
import { Header } from './components/Header'
import { CarryoverCard } from './components/CarryoverCard'
import { ReviewCard } from './components/ReviewCard'
import { DetailPanel } from './components/DetailPanel'
import { Timeline } from './components/Timeline'
import { SettingsPage } from './components/SettingsPage'
import type { SettingsSection } from './components/SettingsPage'
import { localDate, reasonText, toLocalInput } from './format'
import { deviceID } from './device'
import { savedEmail } from './account'
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
const BRIEFING_KEY = 'lifeflow-web-briefing-v1'
const AUTODARK_KEY = 'lifeflow-web-autodark-v1'
const UNDO_WINDOW_MS = 15000

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

function loadFocus(): FocusSession | null {
  try { const raw = localStorage.getItem(FOCUS_KEY); return raw ? JSON.parse(raw) as FocusSession : null } catch { return null }
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
  const [showAll, setShowAll] = useState(false)
  const [editingTask, setEditingTask] = useState<LocalTask | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [themeId, setThemeId] = useState<ThemeId>(() => getTheme(localStorage.getItem(THEME_KEY) ?? undefined).id)
  const theme = getTheme(themeId)
  const [importNotice, setImportNotice] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [repeatRule, setRepeatRule] = useState<RecurrenceRule | null>(null)
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [focusSession, setFocusSession] = useState<FocusSession | null>(loadFocus)
  const [focusTick, setFocusTick] = useState(0)
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
  const [autoDark, setAutoDark] = useState(() => localStorage.getItem(AUTODARK_KEY) === 'on')
  useEffect(() => {
    localStorage.setItem(AUTODARK_KEY, autoDark ? 'on' : 'off')
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    const apply = () => { if (autoDark && mq?.matches) setThemeId('quiet-dark') }
    apply()
    mq?.addEventListener('change', apply)
    return () => mq?.removeEventListener('change', apply)
  }, [autoDark])
  const [blocks, setBlocks] = useState<PlannerFixedBlock[]>(loadBlocks)
  const [blocksOpen, setBlocksOpen] = useState(false)
  const [briefingShownDate, setBriefingShownDate] = useState(() => localStorage.getItem(BRIEFING_KEY))
  const [undo, setUndo] = useState<{ message: string; undo: () => void } | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const [accountEmail, setAccountEmail] = useState(() => savedEmail())

  function showUndo(message: string, restore: () => void) {
    setUndo({ message, undo: restore })
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
  }

  useEffect(() => {
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks))
  }, [blocks])

  function handleQuickAdd(quickTitle: string, quickMinutes: number | undefined) {
    if (!quickTitle) return
    const draft: TaskDraft = { title: quickTitle, importance: 'important', splittable: false, targetDurationMinutes: quickMinutes }
    const created = createTask(draft, new Date().toISOString(), crypto.randomUUID())
    if (created.task) setTasks((current) => [...current, created.task!])
  }

  function handleDetailedAdd(task: StoredTask, repeat: RecurrenceRule | null, deferUntil?: string) {
    let finalTask = task
    if (repeat) {
      const template = createTemplate(crypto.randomUUID(), task.title, repeat, new Date().toISOString())
      template.importance = task.importance
      template.targetDurationMinutes = task.targetDurationMinutes
      template.place = task.place
      template.notes = task.notes
      setTemplates((current) => [...current, template])
      finalTask = { ...task, templateId: template.id, occurrenceDate: repeat.startDate }
    }
    if (deferUntil) finalTask = { ...finalTask, deferredUntil: deferUntil }
    setTasks((current) => [...current, finalTask])
  }

  const [query, setQuery] = useState('')
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (focusSession) return
      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault()
        ;(document.querySelector('input[aria-label="加一件事"]') as HTMLElement | null)?.focus()
      } else if (event.key === '/') {
        event.preventDefault()
        ;(document.querySelector('input[aria-label="搜索任务"]') as HTMLElement | null)?.focus()
      } else if (event.key === 'Escape') {
        setEditingTask(null)
        setBlocksOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusSession])

  const searchQuery = query.trim().toLowerCase()
  const searchMatches = searchQuery ? tasks.filter((task) => [task.title, task.place, task.notes].some((field) => typeof field === 'string' && field.toLowerCase().includes(searchQuery))).slice(0, 20) : []

  function setRepeatForTask(task: LocalTask, rule: RecurrenceRule) {
    const template = createTemplate(crypto.randomUUID(), task.title, rule, new Date().toISOString())
    template.importance = task.importance
    template.targetDurationMinutes = task.targetDurationMinutes
    template.place = task.place
    template.notes = task.notes
    setTemplates((current) => [...current, template])
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, templateId: template.id, occurrenceDate: rule.startDate } : item))
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
  const carryoverItems = carryoverReviewed === todayStr ? [] : selectCarryoverTasks(tasks, todayStr)
  const briefingFacts = buildBriefingFacts({ tasks, planBlocks: plan.planBlocks, unscheduledCount: plan.unscheduledTasks.length, deferredCount: tomorrowTasks.length, carriedCount: carryoverItems.length, settings: plannerInput.settings, now })
  const briefingDue = briefingShownDate !== todayStr && (briefingFacts.taskCount > 0 || plan.unscheduledTasks.length > 0)

  function dismissBriefing() {
    localStorage.setItem(BRIEFING_KEY, todayStr)
    setBriefingShownDate(todayStr)
  }
  const timelineRows = [...timelineEntries, ...blocks.filter((block) => localDate(block.startAt) === todayStr).map((block) => ({ kind: 'block' as const, title: block.title, startAt: block.startAt, endAt: block.endAt }))].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
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

  function toggleTask(id: string) {
    setTasks((current) => current.map((task) => task.id === id
      ? (task.done ? uncompleteTask(task, new Date().toISOString()) : completeTask(task, new Date().toISOString()))
      : task))
  }

  function removeTask(id: string) {
    const index = tasks.findIndex((item) => item.id === id)
    if (index < 0) return
    const task = tasks[index]
    setTasks((current) => deleteTask(current, id))
    if (selectedTaskId === id) setSelectedTaskId(null)
    if (editingTask?.id === id) setEditingTask(null)
    if (focusSession?.taskId === id) setFocusSession(null)
    const hint = task.templateId ? '（明天会生成新的一件）' : ''
    showUndo(`已删除「${task.title}」${hint}`, () => {
      setTasks((current) => {
        const next = [...current]
        next.splice(Math.min(index, next.length), 0, task)
        return next
      })
    })
  }

  function openEditor(task: LocalTask) {
    setEditingTask(task)
    setSelectedTaskId(task.id)
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

  function saveApiConfig() {
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

  function stopRepeatById(templateId: string) {
    setTemplates((current) => current.map((item) => item.id === templateId ? { ...item, paused: true } : item))
  }

  function resumeRepeatById(templateId: string) {
    setTemplates((current) => current.map((item) => item.id === templateId ? { ...item, paused: false } : item))
  }

  function deleteRepeatById(templateId: string) {
    if (!window.confirm('停止这条重复规则？已生成的任务会保留，之后不再生成新的。')) return
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

  const appearanceSection = <section className="settings-section" aria-label="外观设置"><p className="label">APPEARANCE / 外观</p><h2>视觉皮肤</h2><p className="settings-copy">皮肤只改变表现方式，不改变任务、计划规则或数据归属。</p><div className="theme-picker">{themeIds.map((id) => { const option = getTheme(id); return <button className={`theme-option ${themeId === id ? 'selected' : ''}`} type="button" key={id} disabled={autoDark} onClick={() => setThemeId(id)}><span className="theme-swatch" style={{ background: option.tokens.background, borderColor: option.tokens.accent }} /><span><strong>{option.name}</strong><small>{option.description}</small></span></button> })}</div><label className="checkbox-line autodark-line"><input type="checkbox" checked={autoDark} onChange={(event) => setAutoDark(event.target.checked)} />系统深色时自动换到 Quiet Dark</label><div className="bg-picker"><p className="label">背景图</p><p className="settings-copy">用一张自己的图片做页面背景。上传后拖动裁剪框决定画面，缩放滑杆控制取景范围；模糊和遮罩帮文字保持可读。它只影响外观，不影响任务数据。</p>{background.dataUrl && <div className="bg-preview" style={{ backgroundImage: `url(${background.dataUrl})` }} aria-hidden="true" />}<input ref={bgInputRef} className="file-input" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleBackgroundFile(file); event.currentTarget.value = '' }} /><div className="settings-actions"><button className="secondary-button" type="button" onClick={() => bgInputRef.current?.click()}>选择图片</button>{background.dataUrl && <button className="secondary-button" type="button" onClick={() => setCropOpen(true)}>裁剪画面</button>}{background.dataUrl && <button className="secondary-button" type="button" onClick={resetBackgroundParams}>恢复默认参数</button>}{background.dataUrl && <button className="secondary-button" type="button" onClick={removeBackgroundImage}>移除背景图</button>}</div>{cropOpen && background.dataUrl && <CropEditor dataUrl={background.dataUrl} aspect={window.innerWidth / window.innerHeight} onApply={(cropped) => { setBackground((current) => ({ ...current, dataUrl: cropped })); setCropOpen(false) }} onCancel={() => setCropOpen(false)} />}{background.dataUrl && !cropOpen && <div className="bg-controls"><label>模糊<input type="range" min={0} max={24} value={background.blur} onChange={(event) => updateBackground({ blur: Number(event.target.value) })} /><span>{background.blur}px</span></label><label>遮罩<input type="range" min={0} max={85} value={background.dim} onChange={(event) => updateBackground({ dim: Number(event.target.value) })} /><span>{background.dim}%</span></label><label>饱和度<input type="range" min={0} max={200} value={background.saturate} onChange={(event) => updateBackground({ saturate: Number(event.target.value) })} /><span>{background.saturate}%</span></label></div>}{bgNotice && <p className="import-notice">{bgNotice}</p>}</div></section>
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
        accountEmail={accountEmail}
        apiBaseUrl={apiBaseUrl}
        onAccountChanged={() => setAccountEmail(savedEmail())}
      />
    </>
  )

  return (
    <>
      {backgroundLayers}
      {updateReady && <div className="update-toast"><span>LifeFlow 更新好了，刷新一下就能用上新版。</span><button className="secondary-button" type="button" onClick={() => location.reload()}>刷新</button></div>}
      {undo && <div className="undo-toast"><span>{undo.message}</span><button className="link-button" type="button" onClick={() => { undo.undo(); setUndo(null) }}>撤销</button><small>15 秒内有效</small></div>}
      <main className="shell">
      <Header tagline={tagline} today={today} themeId={themeId} onThemeChange={setThemeId} showAll={showAll} onToggleShowAll={() => setShowAll((value) => !value)} onOpenSettings={() => setSettingsOpen(true)} />

      {briefingDue && <BriefingCard facts={briefingFacts} apiBaseUrl={apiBaseUrl} onDismiss={dismissBriefing} />}

      <div className="workspace">
        <aside className="sidebar" aria-label="导航与状态">
          <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur() } }} placeholder="搜索任务（/）" aria-label="搜索任务" />
          <div className="side-block"><p className="side-title">现在</p><div className="side-line"><span>未完成</span><span>{tasks.filter((task) => !task.done).length}</span></div><div className="side-line"><span>已安排</span><span>{plan.planBlocks.length}</span></div></div>
          <div className="side-block"><p className="side-title">库存</p><div className="side-line"><span>未排入</span><span>{plan.unscheduledTasks.length}</span></div><div className="side-line"><span>已完成</span><span>{tasks.filter((task) => task.done).length}</span></div></div>
        </aside>
        <section className="timeline-area">
          <section className="focus-line" aria-label="当前进行"><span className="focus-dot" />{plan.planBlocks.length ? '计划已经准备好了' : '先放下一件事'}<span className="muted">{changeCount ? `计划变了 ${changeCount} 处` : ''}</span></section>

      {carryoverItems.length > 0 && <CarryoverCard items={carryoverItems} keeps={carryoverKeeps} onToggle={(taskId, keep) => setCarryoverKeeps((current) => ({ ...current, [taskId]: keep }))} onFinish={finishCarryover} onSkip={skipCarryover} />}

      <Timeline rows={timelineRows} tasks={tasks} now={now} selectedTaskId={selectedTaskId} planCount={plan.planBlocks.length} changeCount={changeCount} showAll={showAll} unscheduled={plan.unscheduledTasks} tomorrowTasks={tomorrowTasks} tomorrowStr={tomorrowStr} onToggleSelect={(id) => { setSelectedTaskId(id); toggleTask(id) }} onEdit={openEditor} onTaskFlag={setTaskFlag} onOpenSettings={() => { setSettingsSection('planning'); setSettingsOpen(true) }} />

      <CaptureCard apiBaseUrl={apiBaseUrl} blocksOpen={blocksOpen} onQuickAdd={handleQuickAdd} onDetailedAdd={handleDetailedAdd} onOpenBlocks={() => setBlocksOpen(true)} />
      {blocksOpen && <BlocksCard todayBlocks={blocks.filter((block) => localDate(block.startAt) === todayStr)} today={todayStr} onAdd={(block) => setBlocks((current) => [...current, block])} onDelete={(id) => setBlocks((current) => current.filter((item) => item.id !== id))} onClose={() => setBlocksOpen(false)} />}

      {editingTask && <EditCard key={editingTask.id} task={editingTask} templates={templates} onClose={() => setEditingTask(null)} onSaveTask={(updated) => { setTasks((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditingTask(null) }} onDeleteTask={() => removeTask(editingTask.id)} onTaskFlag={setTaskFlag} onPauseRepeat={stopRepeatById} onResumeRepeat={resumeRepeatById} onDeleteRepeat={deleteRepeatById} onSetRepeat={(rule) => setRepeatForTask(editingTask, rule)} />}

      <AiCard tasks={tasks} apiBaseUrl={apiBaseUrl} adopted={preferredOrder !== null} onAdopt={setPreferredOrder} onRestoreRules={() => setPreferredOrder(null)} />
      {searchQuery && <section className="edit-card search-card" aria-label="搜索结果">
        <p className="label">搜索结果</p>
        {searchMatches.length === 0 && <p className="settings-copy">没有匹配的任务。</p>}
        {searchMatches.map((task) => {
          const idx = searchQuery ? task.title.toLowerCase().indexOf(searchQuery) : -1
          const titleNode = idx >= 0
            ? <>{task.title.slice(0, idx)}<mark className="search-highlight">{task.title.slice(idx, idx + searchQuery.length)}</mark>{task.title.slice(idx + searchQuery.length)}</>
            : task.title
          return <div className="deferred-row" key={task.id}><span>{titleNode}{task.done && <small> · 已完成</small>}</span><button className="link-button" type="button" onClick={() => openEditor(task)}>改</button></div>
        })}
      </section>}

      {reviewDue && <ReviewCard items={weekReview} onFinish={finishReview} />}

      <section className="quiet-note"><span className="note-mark">✦</span><p>排不下的时候，我会告诉你原因。<br />不会偷偷吃掉你的休息。</p></section>
      <footer><span>本地保存 · 不需要账号</span><button className="link-button" type="button" onClick={() => setShowAll(true)}>查看全部任务</button><span className="kbd-hints"><b>N</b> 新建 · <b>/</b> 搜索 · <b>Esc</b> 关闭</span></footer>
        </section>
        <DetailPanel task={selectedTask} block={selectedBlock} onOpenEditor={() => { if (selectedTask) openEditor(selectedTask) }} onStartFocus={() => { if (selectedTask) startFocusFor(selectedTask) }} />
      </div>
    </main>
    </>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) createRoot(rootElement).render(<App />)

export default App

