import { useState } from 'react'
import type { BriefingFacts } from '../../../../packages/core/src'

interface BriefingCardProps {
  facts: BriefingFacts
  apiBaseUrl: string
  onDismiss: () => void
}

function localLines(facts: BriefingFacts): string[] {
  const lines: string[] = []
  const parts: string[] = []
  if (facts.taskCount > 0) parts.push(`今天有 ${facts.taskCount} 件事`)
  if (facts.mustCount > 0) parts.push(`${facts.mustCount} 件必须做`)
  if (parts.length > 0) lines.push(`${parts.join('，')}。`)
  if (facts.firstTask) lines.push(`第一件是「${facts.firstTask.title}」，${facts.firstTask.startLocal} 开始。`)
  if (facts.unscheduledCount > 0) lines.push(`有 ${facts.unscheduledCount} 件今天排不下——不是你的错。`)
  if (facts.deferredCount > 0) lines.push(`明天等着你的有 ${facts.deferredCount} 件。`)
  lines.push(`缓冲 ${facts.bufferMinutes} 分钟替你留着。`)
  return lines
}

export function BriefingCard({ facts, apiBaseUrl, onDismiss }: BriefingCardProps) {
  const [aiText, setAiText] = useState('')
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function askAi() {
    setAiState('loading')
    try {
      const response = await fetch(`${apiBaseUrl}/v1/ai/briefing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts }) })
      const result = await response.json() as { ok?: boolean; text?: string }
      if (!response.ok || !result.ok || !result.text) throw new Error('UNAVAILABLE')
      setAiText(result.text); setAiState('done')
    } catch {
      setAiState('error')
    }
  }

  return (
    <section className="edit-card briefing-card" aria-label="今日简报">
      <div className="edit-heading"><p className="label">BRIEFING / 今日简报</p></div>
      {aiState === 'done' ? (
        <p className="settings-copy briefing-text">{aiText}</p>
      ) : (
        <div className="briefing-lines">{localLines(facts).map((line) => <p className="briefing-line" key={line}>{line}</p>)}</div>
      )}
      {aiState === 'loading' && <p className="settings-copy">正在写一份更有温度的……</p>}
      {aiState === 'error' && <p className="voice-error">AI 简报暂时不可用，上面的就够了。</p>}
      <div className="settings-actions">
        {aiState === 'idle' && <button className="link-button" type="button" onClick={askAi}>让 AI 换个说法</button>}
        <button className="secondary-button" type="button" onClick={onDismiss}>开始今天</button>
      </div>
    </section>
  )
}
