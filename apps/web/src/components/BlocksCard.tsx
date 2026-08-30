import { useState } from 'react'
import type { PlannerFixedBlock } from '../../../../packages/core/src'

interface BlocksCardProps {
  todayBlocks: PlannerFixedBlock[]
  today: string
  onAdd: (block: PlannerFixedBlock) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function BlocksCard({ todayBlocks, today, onAdd, onDelete, onClose }: BlocksCardProps) {
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [error, setError] = useState('')

  function add() {
    const cleanTitle = title.trim()
    if (!cleanTitle) { setError('给这段日程起个名字。'); return }
    const validStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(start) ? start : null
    const validEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(end) ? end : null
    if (!validStart || !validEnd) { setError('开始和结束都要填时间。'); return }
    const startAt = new Date(`${today}T${validStart}:00`).toISOString()
    const endAt = new Date(`${today}T${validEnd}:00`).toISOString()
    if (Date.parse(endAt) <= Date.parse(startAt)) { setError('结束要比开始晚。'); return }
    onAdd({ id: crypto.randomUUID(), title: cleanTitle, startAt, endAt, strength: 'hard', movable: false })
    setTitle(''); setError('')
  }

  return (
    <section className="edit-card create-card" aria-label="固定日程">
      <div className="edit-heading"><p className="label">固定日程</p><button className="link-button" type="button" onClick={onClose}>收起</button></div>
      <p className="settings-copy">会议、课程这类挪不动的时间。排程会把它们挖掉，任务不会排进这些时段。</p>
      <div className="edit-grid"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题，比如：组会" aria-label="日程标题" /><div className="block-times"><input type="time" value={start} onChange={(event) => setStart(event.target.value)} aria-label="日程开始" /><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} aria-label="日程结束" /></div></div>
      {error && <p className="error-text">{error}</p>}
      <div className="settings-actions"><button className="add-button" type="button" onClick={add}>添加日程</button></div>
      {todayBlocks.map((block) => <div className="deferred-row" key={block.id}><span>{block.title}</span><span className="decision-actions"><small>{new Date(block.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} — {new Date(block.endAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small><button className="link-button" type="button" onClick={() => onDelete(block.id)}>删除</button></span></div>)}
    </section>
  )
}
