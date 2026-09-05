import { useState } from 'react'
import type { RecurrenceRule, RecurringTemplate, StoredTask, TaskDraft } from '../../../../packages/core/src'
import { editTask, pinTask, unpinTask } from '../../../../packages/core/src'
import { toLocalInput } from '../format'

interface SubtaskDraft { title: string; minutes: number }

interface EditCardProps {
  task: StoredTask
  templates: RecurringTemplate[]
  apiBaseUrl: string
  onClose: () => void
  onSaveTask: (updated: StoredTask) => void
  onCreateSubtasks: (subtasks: Array<{ title: string; minutes: number }>) => void
  onTaskFlag: (id: string, patch: Partial<Pick<StoredTask, 'forceToday' | 'deferredUntil'>>) => void
  onPauseRepeat: (templateId: string) => void
  onResumeRepeat: (templateId: string) => void
  onDeleteRepeat: (templateId: string) => void
  onDeleteTask: () => void
  onSetRepeat: (rule: RecurrenceRule) => void
}

export function EditCard({ task, templates, apiBaseUrl, onClose, onSaveTask, onCreateSubtasks, onDeleteTask, onTaskFlag, onPauseRepeat, onResumeRepeat, onDeleteRepeat, onSetRepeat }: EditCardProps) {
  const [editTitle, setEditTitle] = useState(task.title)
  const [editMinutes, setEditMinutes] = useState(task.targetDurationMinutes?.toString() ?? '')
  const [editPlace, setEditPlace] = useState(task.place ?? '')
  const [editNotes, setEditNotes] = useState(task.notes ?? '')
  const [editImportance, setEditImportance] = useState(task.importance)
  const [editSplittable, setEditSplittable] = useState(task.splittable)
  const [editDeadline, setEditDeadline] = useState(toLocalInput(task.deadlineAt))
  const [editError, setEditError] = useState('')
  const [pinTime, setPinTime] = useState(task.lockedStartAt ? new Date(task.lockedStartAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '')
  const [repeatRule, setRepeatRule] = useState<RecurrenceRule | null>(null)
  const [subtasks, setSubtasks] = useState<Array<{ title: string; minutes: number }> | null>(null)
  const [subtaskBusy, setSubtaskBusy] = useState(false)
  const editingTemplate = task.templateId ? templates.find((item) => item.id === task.templateId) : undefined

  async function askBreakdown() {
    const mins = task.targetDurationMinutes
    if (!mins || mins < 50) return
    setSubtaskBusy(true)
    try {
      const response = await fetch(`${apiBaseUrl}/v1/ai/breakdown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: task.title, minutes: mins }) })
      const result = await response.json() as { ok?: boolean; subtasks?: Array<{ title: string; minutes: number }> }
      if (!response.ok || !result.ok || !result.subtasks) throw new Error()
      setSubtasks(result.subtasks)
    } catch {
      setSubtasks([])
    } finally {
      setSubtaskBusy(false)
    }
  }

  function acceptSubtasks() {
    if (!subtasks) return
    onCreateSubtasks(subtasks)
    setSubtasks(null)
  }

  function save() {
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
    const result = editTask(task, draft, new Date().toISOString())
    if (!result.task) {
      setEditError(result.issues[0]?.code === 'TITLE_REQUIRED' ? '给它起个名字就好。' : '时间要填正整数，或者留空。')
      return
    }
    let saved = result.task
    if (pinTime) {
      const pinned = pinTask(saved, pinTime, new Date().toISOString().slice(0, 10), 'Asia/Shanghai', new Date().toISOString())
      if (!pinned.task) { setEditError('这个时间已经过去了，或者时长还没填。'); return }
      saved = pinned.task
    } else if (task.lockedStartAt) {
      saved = unpinTask(saved, new Date().toISOString())
    }
    onSaveTask(saved)
  }

  return (
    <section className="edit-card" aria-label="编辑任务">
      <div className="edit-heading"><p className="label">编辑任务</p><span className="edit-heading-actions"><button className="link-button danger-link" type="button" onClick={onDeleteTask}>删除这件事</button><button className="link-button" type="button" onClick={onClose}>取消</button></span></div>
      <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="要做什么？" />
      <div className="edit-grid"><input value={editMinutes} onChange={(event) => setEditMinutes(event.target.value)} placeholder="分钟" inputMode="numeric" /><input value={editPlace} onChange={(event) => setEditPlace(event.target.value)} placeholder="在哪里" /></div>
      <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="描述" rows={3} />
      <div className="repeat-panel"><span className="edit-hint">重要性</span>{([['must', '必须做'], ['important', '重要'], ['want', '想做']] as Array<[import('../../../../packages/core/src').Importance, string]>).map(([value, label]) => <button className={editImportance === value ? 'choice active' : 'choice'} type="button" key={value} onClick={() => setEditImportance(value)}>{label}</button>)}</div>
      <div className="repeat-panel"><span className="edit-hint">拆分</span><button className={editSplittable ? 'choice active' : 'choice'} type="button" onClick={() => setEditSplittable((value) => !value)}>{editSplittable ? '可以切小块' : '不切分'}</button><span className="edit-hint">超过 50 分钟的长任务自动按 25 分钟切块</span></div>
      <div className="edit-grid"><input type="datetime-local" value={editDeadline} onChange={(event) => setEditDeadline(event.target.value)} aria-label="截止时间" /><span className="edit-hint">截止时间，可选</span></div>
      <div className="edit-grid"><input type="time" value={pinTime} onChange={(event) => setPinTime(event.target.value)} /><span className="edit-hint">留空表示自动安排</span></div>
      {(task.targetDurationMinutes ?? 0) >= 50 && <div className="repeat-panel"><span className="edit-hint">拆解</span><button className="link-button" type="button" onClick={askBreakdown} disabled={subtaskBusy}>{subtaskBusy ? '思考中……' : '让 AI 拆解'}</button></div>}
      {subtasks && subtasks.length > 0 && <div className="subtask-drafts">
        <p className="edit-hint">AI 建议拆成以下子任务：</p>
        {subtasks.map((st, i) => <div className="subtask-draft-row" key={i}><span className="subtask-num">{i + 1}</span><span>{st.title}</span><small>{st.minutes} 分钟</small></div>)}
        <div className="settings-actions"><button className="secondary-button" type="button" onClick={acceptSubtasks}>采纳为独立任务</button></div>
      </div>}
      <div className="repeat-panel">
        <span className="edit-hint">重复</span>
        {!task.templateId && <><button className={repeatRule?.kind === 'daily' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeatRule({ kind: 'daily', startDate: new Date().toISOString().slice(0, 10) })}>每天</button>
        <button className={repeatRule?.kind === 'weekly' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeatRule({ kind: 'weekly', startDate: new Date().toISOString().slice(0, 10) })}>每周</button></>}
        {repeatRule && !task.templateId && <button className="secondary-button" type="button" onClick={() => { onSetRepeat(repeatRule); setRepeatRule(null) }}>保存重复规则</button>}
        {task.templateId && !editingTemplate?.paused && <button className="link-button" type="button" onClick={() => onPauseRepeat(task.templateId!)}>暂停重复</button>}
        {task.templateId && editingTemplate?.paused && <button className="link-button" type="button" onClick={() => onResumeRepeat(task.templateId!)}>恢复重复</button>}
        {task.templateId && <button className="link-button" type="button" onClick={() => onDeleteRepeat(task.templateId!)}>不再重复</button>}
      </div>
      {(task.deferredUntil || task.forceToday) && <div className="repeat-panel">
        {task.deferredUntil && <><span className="edit-hint">已放到 {task.deferredUntil}，那天自动排入</span><button className="link-button" type="button" onClick={() => onTaskFlag(task.id, { deferredUntil: undefined })}>留在今天</button></>}
        {task.forceToday && <><span className="edit-hint">已让它留在今天（可占用休息）</span><button className="link-button" type="button" onClick={() => onTaskFlag(task.id, { forceToday: undefined })}>恢复自动安排</button></>}
      </div>}
      {editError && <p className="error-text">{editError}</p>}
      <button className="add-button save-edit" type="button" onClick={save}>保存修改</button>
    </section>
  )
}
