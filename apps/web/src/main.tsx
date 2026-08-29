import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ExistingPlanBlock, PlannerTask, StoredTask, TaskDraft, RecurrenceRule, RecurringTemplate, ThemeId } from '../../../packages/core/src'
import { buildExport, buildTimelineEntries, createTask, createTemplate, editTask, getTheme, materializeOccurrences, mergeImportedTasks, parseImport, pinTask, replanToday, completeTask, uncompleteTask, unpinTask, themeIds } from '../../../packages/core/src'
import './styles.css'

type LocalTask = StoredTask
const STORAGE_KEY = 'lifeflow-web-tasks-v1'
const PLAN_KEY = 'lifeflow-web-plan-v1'
const TEMPLATE_KEY = 'lifeflow-web-templates-v1'
const THEME_KEY = 'lifeflow-web-theme-v1'
const API_URL = 'https://lifeflow-api.mosesbeck761988kdl.workers.dev'
const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())

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
  const [themeId, setThemeId] = useState<ThemeId>(() => getTheme(localStorage.getItem(THEME_KEY) ?? undefined).id)
  const theme = getTheme(themeId)
  const [importNotice, setImportNotice] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [repeatRule, setRepeatRule] = useState<RecurrenceRule | null>(null)
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [pinTime, setPinTime] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [aiReason, setAiReason] = useState('')
  const [aiOrder, setAiOrder] = useState<string[]>([])

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
  }, [themeId, theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])
  useEffect(() => {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates))
  }, [templates])

  useEffect(() => {
    const date = new Date().toISOString().slice(0, 10)
    const materialized = materializeOccurrences(templates, tasks, date, new Date().toISOString())
    if (materialized.length !== tasks.length) setTasks(materialized)
  }, [templates])

  const plannerInput = useMemo(() => ({
    now: new Date().toISOString(),
    settings: {
      timezone: 'Asia/Shanghai', planningDate: new Date().toISOString().slice(0, 10),
      availabilityStartLocalTime: '08:00', availabilityEndLocalTime: '23:30', dailyBufferMinutes: 45,
      rest: { enabled: true, startLocalTime: '23:30', endLocalTime: '07:30' },
    },
    tasks: tasks.filter((task) => !task.done), fixedBlocks: [],
  }), [tasks])

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
  const timelineEntries = buildTimelineEntries(plan.planBlocks, plannerInput.settings)
  const changeCount = plan.changes.length

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

  function openEditor(task: LocalTask) {
    setEditingTask(task)
    setEditTitle(task.title)
    setEditMinutes(task.targetDurationMinutes?.toString() ?? '')
    setEditPlace(task.place ?? '')
    setEditNotes(task.notes ?? '')
    setEditError('')
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
      importance: editingTask.importance,
      splittable: editingTask.splittable,
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
      const pinned = pinTask(saved, pinTime, new Date().toISOString().slice(0, 10), 'Asia/Shanghai', new Date().toISOString())
      if (!pinned.task) { setEditError('这个时间已经过去了，或者时长还没填。'); return }
      saved = pinned.task
    } else if (editingTask.lockedStartAt) {
      saved = unpinTask(saved, new Date().toISOString())
    }
    setTasks((current) => current.map((task) => task.id === editingTask.id ? saved : task))
    setEditingTask(null)
  }

  async function askAiOrder() {
    const candidates = tasks.filter((task) => !task.done && task.targetDurationMinutes !== undefined).slice(0, 20).map((task) => ({ id: task.id, title: task.title, durationMinutes: task.targetDurationMinutes!, importance: task.importance }))
    if (candidates.length === 0) return
    setAiState('loading'); setAiReason('')
    try {
      const response = await fetch(`${API_URL}/v1/ai/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: candidates }) })
      const result = await response.json() as { ok?: boolean; order?: string[]; reason?: string }
      if (!response.ok || !result.ok || !result.order || !result.reason) throw new Error('AI_UNAVAILABLE')
      setAiOrder(result.order); setAiReason(result.reason); setAiState('ready')
    } catch {
      setAiState('error'); setAiReason('AI 暂时不可用，本地计划没有改变。')
    }
  }

  function exportData() {
    const blob = new Blob([buildExport(tasks, templates)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `lifeflow-${new Date().toISOString().slice(0, 10)}.json`
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
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(PLAN_KEY)
    setTasks([])
    setExistingBlocks([])
    setSettingsOpen(false)
  }

  function toggleRepeatDay(day: number) {
    setRepeatDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day])
  }

  function saveRepeat() {
    if (!editingTask || (repeatRule?.kind === 'weekly' && repeatDays.length === 0)) return
    const kind = repeatRule?.kind ?? 'daily'
    const rule: RecurrenceRule = { kind, weekdays: kind === 'weekly' ? repeatDays : undefined, startDate: new Date().toISOString().slice(0, 10) }
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

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">LIFEFLOW</p>
          <h1>今天，慢慢来。</h1>
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

      <section className="timeline-card" aria-label="今日时间线">
        <div className="section-heading">
          <div><p className="label">今日时间线</p><h2>{showAll ? '全部任务' : '接下来'}</h2></div>
          <span className="muted">{changeCount ? `计划变了 ${changeCount} 处` : `${plan.planBlocks.length} 件已安排`}</span>
        </div>
        <div className="timeline">
          {visibleTasks.length === 0 && <p className="empty">还没有安排。把现实中的事情写在下面。</p>}
          {timelineEntries.map((entry) => {
            if (entry.kind !== 'task') return <div className={`special-row ${entry.kind}`} key={`${entry.kind}-${entry.startAt}`}><span className="special-time">{new Date(entry.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span><span>{entry.title}</span><small>{entry.kind === 'buffer' ? '为变化留出空间' : '这段时间本身就是计划的一部分'}</small></div>
            const task = tasks.find((candidate) => candidate.id === entry.taskId)
            if (!task) return null
            return <div className={`task-row ${task.done ? 'is-done' : ''} ${selectedTaskId === task.id ? 'is-selected' : ''}`} key={task.id}>
              <button className="task-main" type="button" onClick={() => { setSelectedTaskId(task.id); toggleTask(task.id) }}><span className="task-check" aria-hidden="true">{task.done ? '✓' : ''}</span><span className="task-copy"><span className="task-title">{task.title}</span><span className="task-place">{task.targetDurationMinutes ? `${task.targetDurationMinutes} 分钟` : '还没估时间'}{task.place ? ` · ${task.place}` : ''}</span>{task.notes && <span className="task-notes">{task.notes}</span>}</span></button>
              <span className="task-time"><strong>{new Date(entry.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</strong><small>{task.done ? '已完成' : entry.source === 'manualLock' ? '已锁定' : '已安排'}</small></span>
              <button className="edit-button" type="button" onClick={() => openEditor(task)}>改</button>
            </div>
          })}
          {showAll && plan.unscheduledTasks.length > 0 && <div className="deferred-list">
            <p className="label">今天没排进去</p>
            {plan.unscheduledTasks.map((item) => {
              const task = tasks.find((candidate) => candidate.id === item.taskId)
              return task && <div className="deferred-row" key={item.taskId}><span>{task.title}</span><small>{reasonText(item.reasonCodes)}</small></div>
            })}
          </div>}
        </div>
      </section>

      <section className="capture" aria-label="快速添加">
        <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTask() }} placeholder="加一件事" aria-label="加一件事" />
        <input className="minutes-input" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="预计分钟" inputMode="numeric" />
        <span className="minutes-label">分</span>
        <button className="add-button" type="button" onClick={addTask}>加</button>
      </section>

      {editingTask && <section className="edit-card" aria-label="编辑任务">
        <div className="edit-heading"><p className="label">编辑任务</p><button className="link-button" type="button" onClick={() => setEditingTask(null)}>取消</button></div>
        <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="要做什么？" />
        <div className="edit-grid"><input value={editMinutes} onChange={(event) => setEditMinutes(event.target.value)} placeholder="分钟" inputMode="numeric" /><input value={editPlace} onChange={(event) => setEditPlace(event.target.value)} placeholder="在哪里" /></div>
        <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="描述" rows={3} />
        <div className="edit-grid"><input type="time" value={pinTime} onChange={(event) => setPinTime(event.target.value)} /><span className="edit-hint">留空表示自动安排</span></div>
        <div className="repeat-panel">
          <span className="edit-hint">重复</span>
          <button className={repeatRule?.kind === 'daily' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeatRule({ kind: 'daily', startDate: new Date().toISOString().slice(0, 10) })}>每天</button>
          <button className={repeatRule?.kind === 'weekly' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeatRule({ kind: 'weekly', weekdays: repeatDays, startDate: new Date().toISOString().slice(0, 10) })}>每周</button>
          {repeatRule?.kind === 'weekly' && <div className="weekday-list">{['日', '一', '二', '三', '四', '五', '六'].map((label, index) => <button className={repeatDays.includes(index) ? 'day active' : 'day'} type="button" key={label} onClick={() => toggleRepeatDay(index)}>{label}</button>)}</div>}
          {repeatRule && <button className="secondary-button" type="button" onClick={saveRepeat}>保存重复规则</button>}
          {editingTask.templateId && <button className="link-button" type="button" onClick={() => stopRepeat(editingTask)}>暂停重复</button>}
        </div>
        {editError && <p className="error-text">{editError}</p>}
        <button className="add-button save-edit" type="button" onClick={saveEdit}>保存修改</button>
      </section>}

      {settingsOpen && <section className="edit-card settings-card" aria-label="数据设置">
        <div className="edit-heading"><p className="label">数据</p><button className="link-button" type="button" onClick={() => setSettingsOpen(false)}>收起</button></div>
        <p className="settings-copy">任务只保存在这台设备的浏览器里。没有账号，也不会自动上传。导入时，相同任务会保留更新时间较新的一份。</p>
        <div className="theme-picker"><p className="label">视觉皮肤</p>{themeIds.map((id) => { const option = getTheme(id); return <button className={`theme-option ${themeId === id ? 'selected' : ''}`} type="button" key={id} onClick={() => setThemeId(id)}><span className="theme-swatch" style={{ background: option.tokens.background, borderColor: option.tokens.accent }} /><span><strong>{option.name}</strong><small>{option.description}</small></span></button> })}</div>
        <input ref={importInputRef} className="file-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importData(file); event.currentTarget.value = '' }} />
        <div className="settings-actions"><button className="secondary-button" type="button" onClick={exportData}>导出数据</button><button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>导入数据</button><button className="danger-button" type="button" onClick={deleteAllData}>删除全部数据</button></div>
        {importNotice && <p className="import-notice">{importNotice}</p>}
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
            <ul className="detail-list"><li>{selectedTask.importance === 'must' ? '你标记了今天需要完成' : '按当前可用时间安排'}</li><li>{selectedTask.targetDurationMinutes ? `预计需要 ${selectedTask.targetDurationMinutes} 分钟` : '需要先补充预计时间'}</li>{selectedBlock?.source === 'manualLock' && <li>这是你手动锁定的时间</li>}</ul>
            <button className="edit-button" type="button" onClick={() => openEditor(selectedTask)}>编辑这件事</button>
            <div className="ai-advice"><p className="label">AI 建议 · 可选</p>{aiState === 'idle' && <button className="secondary-button" type="button" onClick={askAiOrder}>查看建议顺序</button>}{aiState === 'loading' && <p className="detail-empty">正在整理顺序……</p>}{aiState === 'error' && <p className="error-text">{aiReason}</p>}{aiState === 'ready' && <><p className="detail-empty">{aiReason}</p><p className="ai-order">{aiOrder.map((id) => tasks.find((task) => task.id === id)?.title).filter(Boolean).join(' → ')}</p><small>这只是建议，不会自动改变时间线。</small></>}</div>
          </> : <p className="detail-empty">选择一件事，查看它为什么出现在这里。</p>}
        </aside>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
