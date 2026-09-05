import type { CarryoverItem } from '../../../../packages/core/src'

interface CarryoverCardProps {
  items: CarryoverItem[]
  keeps: Record<string, boolean>
  onToggle: (taskId: string, keep: boolean) => void
  onFinish: () => void
  onSkip: () => void
}

export function CarryoverCard({ items, keeps, onToggle, onFinish, onSkip }: CarryoverCardProps) {
  return (
    <section className="edit-card carryover-card" aria-label="隔夜整理">
      <div className="edit-heading"><p className="label">CARRYOVER / 隔夜整理</p></div>
      <div className="carryover-list">{items.map((item) => <label className="carryover-row" key={item.taskId}><input type="checkbox" checked={keeps[item.taskId] ?? true} onChange={(event) => onToggle(item.taskId, event.target.checked)} /><span className="carryover-title">{item.title}</span>{item.minutes !== undefined && <small className="carryover-minutes">{item.minutes} 分钟</small>}</label>)}</div>
      <p className="settings-copy">昨天留下来的事，还想继续吗？勾着的留下，去掉的轻轻放下，不记任何账。</p>
      <div className="carryover-actions"><button className="link-button" type="button" onClick={onSkip}>先不管</button><button className="secondary-button" type="button" onClick={onFinish}>好，继续</button></div>
    </section>
  )
}
