import type { PlanBlock, StoredTask } from '../../../../packages/core/src'

interface DetailPanelProps {
  task: StoredTask
  block: PlanBlock | undefined
  onOpenEditor: () => void
  onStartFocus: () => void
}

export function DetailPanel({ task, block, onOpenEditor, onStartFocus }: DetailPanelProps) {
  return (
    <aside className="detail-panel" aria-label="任务详情">
      <p className="label">任务详情</p>
      <h2 className="detail-title">{task.title}</h2>
      {block && <p className="detail-time">{new Date(block.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} — {new Date(block.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>}
      <p className="detail-meta">{task.targetDurationMinutes ? `${task.targetDurationMinutes} 分钟` : '还没估时间'}{task.place ? ` · ${task.place}` : ''}</p>
      {task.notes && <p className="detail-empty">{task.notes}</p>}
      <div className="detail-rule" />
      <p className="label">为什么在这里</p>
      <ul className="detail-list"><li>{task.importance === 'must' ? '你标记了今天需要完成' : task.importance === 'want' ? '你想做的事，排在重要事情之后' : '按当前可用时间安排'}</li><li>{task.targetDurationMinutes ? `预计需要 ${task.targetDurationMinutes} 分钟` : '需要先补充预计时间'}</li>{block?.source === 'manualLock' && <li>这是你手动锁定的时间</li>}</ul>
      <button className="edit-button" type="button" onClick={onOpenEditor}>编辑这件事</button>
      <div className="focus-panel"><p className="label">专注</p><button className="secondary-button" type="button" onClick={onStartFocus}>开始专注</button></div>
    </aside>
  )
}
