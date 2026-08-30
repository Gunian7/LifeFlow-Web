import { useState } from 'react'
import type { StoredTask } from '../../../../packages/core/src'

interface AiCardProps {
  tasks: StoredTask[]
  apiBaseUrl: string
  adopted: boolean
  onAdopt: (order: string[]) => void
  onRestoreRules: () => void
}

type AiState = 'idle' | 'loading' | 'ready' | 'error'

export function AiCard({ tasks, apiBaseUrl, adopted, onAdopt, onRestoreRules }: AiCardProps) {
  const [state, setState] = useState<AiState>('idle')
  const [reason, setReason] = useState('')
  const [order, setOrder] = useState<string[]>([])

  function dismiss() {
    setState('idle'); setOrder([]); setReason('')
  }

  async function ask() {
    const candidates = tasks.filter((task) => !task.done && task.targetDurationMinutes !== undefined).slice(0, 20).map((task) => ({ id: task.id, title: task.title, durationMinutes: task.targetDurationMinutes!, importance: task.importance }))
    if (candidates.length === 0) return
    setState('loading'); setReason('')
    try {
      const response = await fetch(`${apiBaseUrl}/v1/ai/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: candidates }) })
      const result = await response.json() as { ok?: boolean; order?: string[]; reason?: string }
      if (!response.ok || !result.ok || !result.order || !result.reason) throw new Error('AI_UNAVAILABLE')
      setOrder(result.order); setReason(result.reason); setState('ready')
    } catch {
      setState('error'); setReason('AI 暂时不可用，本地计划没有改变。')
    }
  }

  return (
    <section className="edit-card ai-card" aria-label="AI 建议顺序">
      <div className="edit-heading"><p className="label">AI 建议 · 可选</p>{state === 'ready' && <button className="link-button" type="button" onClick={dismiss}>收起</button>}</div>
      {adopted && <div className="ai-adopted"><p className="detail-empty">已按建议顺序重排，休息和缓冲仍由规则保护。</p><button className="link-button" type="button" onClick={onRestoreRules}>恢复规则排序</button></div>}
      {state === 'idle' && <><p className="settings-copy">让 AI 根据重要性和今天剩下的时间给任务排个顺序。它只提建议，采纳与否由你决定。</p><button className="secondary-button" type="button" onClick={ask}>查看建议顺序</button></>}
      {state === 'loading' && <p className="detail-empty">正在整理顺序……</p>}
      {state === 'error' && <p className="error-text">{reason}</p>}
      {state === 'ready' && <><p className="detail-empty">{reason}</p><p className="ai-order">{order.map((id) => tasks.find((task) => task.id === id)?.title).filter(Boolean).join(' → ')}</p><div className="settings-actions"><button className="secondary-button" type="button" onClick={() => { onAdopt(order); dismiss() }}>就这么排</button><button className="link-button" type="button" onClick={dismiss}>不用</button></div><small>采纳后本地规则仍负责具体时间安排，休息和缓冲照常保护。</small></>}
    </section>
  )
}
