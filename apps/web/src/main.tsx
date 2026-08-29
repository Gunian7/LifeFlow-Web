import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ExistingPlanBlock, PlannerTask, StoredTask, TaskDraft, RecurrenceRule, RecurringTemplate } from '../../../packages/core/src'
import { buildExport, createTask, createTemplate, editTask, materializeOccurrences, pinTask, replanToday, completeTask, uncompleteTask, unpinTask } from '../../../packages/core/src'
import './styles.css'

type LocalTask = StoredTask
const STORAGE_KEY = 'lifeflow-web-tasks-v1'
const PLAN_KEY = 'lifeflow-web-plan-v1'
const TEMPLATE_KEY = 'lifeflow-web-templates-v1'
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
  const [repeatRule, setRepeatRule] = useState<RecurrenceRule | null>(null)
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [pinTime, setPinTime] = useState('')

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

  function exportData() {
    const blob = new Blob([buildExport(tasks)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `lifeflow-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
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
          <button className="ghost-button" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? '只看今天' : '全部任务'}</button>
          <button className="ghost-button" type="button" onClick={() => setSettingsOpen((value) => !value)}>设置</button>
        </div>
      </header>

      <section className="focus-card" aria-label="当前进行">
        <span className="focus-dot" />
        <div>
          <p className="label">现在</p>
          <strong>{plan.planBlocks.length ? '计划已经准备好了' : '先放下一件事'}</strong>
        </div>
        <span className="muted">{tasks.filter((task) => !task.done).length} 件未完成</span>
      </section>

      <section className="timeline-card" aria-label="今日时间线">
        <div className="section-heading">
          <div><p className="label">今日时间线</p><h2>{showAll ? '全部任务' : '接下来'}</h2></div>
          <span className="muted">{changeCount ? `计划变了 ${changeCount} 处` : `${plan.planBlocks.length} 件已安排`}</span>
        </div>
        <div className="timeline">
          {visibleTasks.length === 0 && <p className="empty">还没有安排。把想做的事写在下面。</p>}
          {visibleTasks.map((task) => {
            const block = plan.planBlocks.find((item) => item.taskId === task.id)
            const start = block ? new Date(block.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '未安排'
            return (
              <div className={`task-row ${task.done ? 'is-done' : ''}`} key={task.id}>
                <button className="task-main" type="button" onClick={() => toggleTask(task.id)}>
                  <span className="task-check" aria-hidden="true">{task.done ? '✓' : ''}</span>
                  <span className="task-copy"><span className="task-title">{task.title}</span><span className="task-place">{task.targetDurationMinutes ? `${task.targetDurationMinutes} 分钟` : '还没估时间'}{task.place ? ` · ${task.place}` : ''}</span>{task.notes && <span className="task-notes">{task.notes}</span>}</span>
                </button>
                <span className="task-time"><strong>{start}</strong><small>{task.done ? '已完成' : block ? '已安排' : '等着'}</small></span>
                <button className="edit-button" type="button" onClick={() => openEditor(task)}>改</button>
              </div>
            )
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
        <p className="settings-copy">任务只保存在这台设备的浏览器里。没有账号，也不会自动上传。</p>
        <div className="settings-actions"><button className="secondary-button" type="button" onClick={exportData}>导出数据</button><button className="danger-button" type="button" onClick={deleteAllData}>删除全部数据</button></div>
      </section>}

      <section className="quiet-note"><span className="note-mark">✦</span><p>排不下的时候，我会告诉你原因。<br />不会偷偷吃掉你的休息。</p></section>
      <footer><span>本地保存 · 不需要账号</span><button className="link-button" type="button" onClick={() => setShowAll(true)}>查看全部任务</button></footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
