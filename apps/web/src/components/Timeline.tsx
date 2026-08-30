import type { StoredTask } from '../../../../packages/core/src'
import { reasonText } from '../format'

type SpecialKind = 'rest' | 'buffer' | 'block'
export interface BlockRow { kind: 'block'; title: string; startAt: string; endAt: string }

interface TimelineProps {
  rows: Array<{ kind: string; title?: string; startAt: string; endAt?: string; taskId?: string; source?: string }>
  tasks: StoredTask[]
  now: string
  selectedTaskId: string | null
  planCount: number
  changeCount: number
  showAll: boolean
  unscheduled: Array<{ taskId: string; reasonCodes: string[] }>
  tomorrowTasks: StoredTask[]
  tomorrowStr: string
  onToggleSelect: (id: string) => void
  onEdit: (task: StoredTask) => void
  onTaskFlag: (id: string, patch: Partial<Pick<StoredTask, 'forceToday' | 'deferredUntil'>>) => void
  onOpenSettings: () => void
}

export function Timeline({ rows, tasks, now, selectedTaskId, planCount, changeCount, showAll, unscheduled, tomorrowTasks, tomorrowStr, onToggleSelect, onEdit, onTaskFlag, onOpenSettings }: TimelineProps) {
  return (
    <section className="timeline-card" aria-label="今日时间线">
      <div className="section-heading">
        <div><p className="label">今日时间线</p><h2>{showAll ? '全部任务' : '接下来'}</h2></div>
        <span className="muted">{changeCount ? `计划变了 ${changeCount} 处` : `${planCount} 件已安排`}</span>
      </div>
      <div className="timeline">
        {rows.length === 0 && showAll && <p className="empty">还没有安排。把现实中的事情写在下面。</p>}
        {rows.map((entry) => {
          if (entry.kind === 'block') return <div className="special-row block" key={`block-${entry.startAt}-${entry.title}`}><span className="row-time">{new Date(entry.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span><span className="row-rail" aria-hidden="true"><i className="rail-dot is-block" /></span><span className="special-copy"><span>{entry.title}</span><small>固定日程，任务不会排进来</small></span></div>
          if (entry.kind !== 'task') return <div className={`special-row ${entry.kind}`} key={`${entry.kind}-${entry.startAt}`}><span className="row-time">{new Date(entry.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span><span className="row-rail" aria-hidden="true"><i className="rail-dot" /></span><span className="special-copy"><span>{entry.title}</span><small>{entry.kind === 'buffer' ? '为变化留出空间' : '这段时间本身就是计划的一部分'}</small></span></div>
          const task = tasks.find((candidate) => candidate.id === entry.taskId)
          if (!task) return null
          const isCurrent = !task.done && Date.parse(entry.startAt!) <= Date.parse(now) && Date.parse(now) < Date.parse(entry.endAt!)
          return <div className={`task-row ${task.done ? 'is-done' : ''} ${selectedTaskId === task.id ? 'is-selected' : ''} ${isCurrent ? 'is-current' : ''}`} key={task.id}>
            <span className="row-time">{new Date(entry.startAt!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="row-rail" aria-hidden="true"><i className={`rail-dot ${isCurrent ? 'is-now' : ''}`} /></span>
            <button className="task-main" type="button" onClick={() => onToggleSelect(task.id)}><span className="task-check" aria-hidden="true">{task.done ? '✓' : ''}</span><span className="task-copy"><span className="task-title">{task.title}{task.importance === 'must' && <span className="importance-badge">必须做</span>}</span><span className="task-place">{task.targetDurationMinutes ? `${task.targetDurationMinutes} 分钟` : '还没估时间'}{task.place ? ` · ${task.place}` : ''}</span>{task.notes && <span className="task-notes">{task.notes}</span>}</span></button>
            <span className="task-side">{isCurrent && <span className="now-chip">现在</span>}<small>{task.done ? '已完成' : entry.source === 'manualLock' ? '已锁定' : '已安排'}</small></span>
            <button className="edit-button" type="button" onClick={() => onEdit(task)}>改</button>
          </div>
        })}
        {showAll && unscheduled.length > 0 && <div className="deferred-list">
          <p className="label">今天没排进去</p>
          {unscheduled.map((item) => {
            const task = tasks.find((candidate) => candidate.id === item.taskId)
            const decidable = item.reasonCodes.includes('PRESERVED_BUFFER') || item.reasonCodes.includes('REST_PROTECTION') || item.reasonCodes.includes('INSUFFICIENT_TIME')
            return task && <div className="deferred-row decision-row" key={item.taskId}>
              <span>{task.title}</span>
              {decidable ? <span className="decision-actions"><small>{reasonText(item.reasonCodes)}</small><button className="link-button" type="button" onClick={() => onEdit(task)}>改</button><button className="link-button" type="button" onClick={() => onTaskFlag(item.taskId, { forceToday: true })}>放在今天</button><button className="link-button" type="button" onClick={() => onTaskFlag(item.taskId, { deferredUntil: tomorrowStr })}>放到明天</button><button className="link-button" type="button" onClick={onOpenSettings}>调整时段</button></span> : <small>{reasonText(item.reasonCodes)}</small>}
            </div>
          })}
          {tomorrowTasks.length > 0 && <div className="tomorrow-group"><p className="label">明天见</p>{tomorrowTasks.map((task) => <div className="deferred-row" key={task.id}><span>{task.title}</span><span className="decision-actions"><small>明天自动排入</small><button className="link-button" type="button" onClick={() => onTaskFlag(task.id, { deferredUntil: undefined })}>留在今天</button></span></div>)}</div>}
        </div>}
      </div>
    </section>
  )
}
