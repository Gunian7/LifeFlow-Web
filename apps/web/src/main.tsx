import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ExistingPlanBlock, PlannerTask } from '../../../packages/core/src'
import { replanToday } from '../../../packages/core/src'
import './styles.css'

type LocalTask = PlannerTask & { done: boolean; place?: string }
const STORAGE_KEY = 'lifeflow-web-tasks-v1'
const PLAN_KEY = 'lifeflow-web-plan-v1'
const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())

const initialTasks: LocalTask[] = [
  { id: 'welcome', title: '试着加一件自己的事', status: 'inbox', importance: 'must', targetDurationMinutes: 30, splittable: false, done: false },
]

function loadTasks(): LocalTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as LocalTask[] : initialTasks
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

function App() {
  const [tasks, setTasks] = useState<LocalTask[]>(loadTasks)
  const [existingBlocks, setExistingBlocks] = useState<ExistingPlanBlock[]>(loadPlan)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])

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
    const next: LocalTask = {
      id: crypto.randomUUID(), title: cleanTitle, status: 'inbox', importance: 'important',
      targetDurationMinutes: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
      splittable: false, done: false,
    }
    setTasks((current) => [...current, next])
    setTitle('')
    setMinutes('30')
  }

  function toggleTask(id: string) {
    setTasks((current) => current.map((task) => task.id === id
      ? { ...task, done: !task.done, status: task.done ? 'inbox' : 'completed' }
      : task))
  }

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">LIFEFLOW</p>
          <h1>今天，慢慢来。</h1>
          <p className="date">{today}</p>
        </div>
        <button className="ghost-button" type="button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? '只看今天' : '全部任务'}
        </button>
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
              <button className={`task-row ${task.done ? 'is-done' : ''}`} type="button" key={task.id} onClick={() => toggleTask(task.id)}>
                <span className="task-check" aria-hidden="true">{task.done ? '✓' : ''}</span>
                <span className="task-copy"><span className="task-title">{task.title}</span><span className="task-place">{task.targetDurationMinutes ? `${task.targetDurationMinutes} 分钟` : '还没估时间'}</span></span>
                <span className="task-time"><strong>{start}</strong><small>{task.done ? '已完成' : block ? '已安排' : '等着'}</small></span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="capture" aria-label="快速添加">
        <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTask() }} placeholder="加一件事" aria-label="加一件事" />
        <input className="minutes-input" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="预计分钟" inputMode="numeric" />
        <span className="minutes-label">分</span>
        <button className="add-button" type="button" onClick={addTask}>加</button>
      </section>

      <section className="quiet-note"><span className="note-mark">✦</span><p>排不下的时候，我会告诉你原因。<br />不会偷偷吃掉你的休息。</p></section>
      <footer><span>本地保存 · 不需要账号</span><button className="link-button" type="button" onClick={() => setShowAll(true)}>查看全部任务</button></footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
