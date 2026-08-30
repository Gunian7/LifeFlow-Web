import { useCallback, useRef, useState } from 'react'
import type { Importance, RecurrenceRule, StoredTask, TaskDraft } from '../../../../packages/core/src'
import { createTask, pinTask } from '../../../../packages/core/src'
import { localDate } from '../format'
import { speechSupported, useSpeechRecognition } from '../speech'

interface CaptureCardProps {
  blocksOpen: boolean
  onQuickAdd: (title: string, minutes: number | undefined) => void
  onDetailedAdd: (task: StoredTask, repeat: RecurrenceRule | null) => void
  onOpenBlocks: () => void
}

export function CaptureCard({ blocksOpen, onQuickAdd, onDetailedAdd, onOpenBlocks }: CaptureCardProps) {
  const [voiceSupported] = useState(speechSupported)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [createOpen, setCreateOpen] = useState(false)
  const [importance, setImportance] = useState<Importance>('important')
  const [splittable, setSplittable] = useState(false)
  const [deadline, setDeadline] = useState('')
  const [place, setPlace] = useState('')
  const [notes, setNotes] = useState('')
  const [pinTime, setPinTime] = useState('')
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(null)
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [error, setError] = useState('')

  const voiceBaseRef = useRef('')
  const handleVoiceText = useCallback((chunk: string, finalText: string) => {
    setTitle(voiceBaseRef.current + finalText + chunk)
  }, [])
  const { listening: voiceListening, error: voiceError, start: startVoice, stop: stopVoice } = useSpeechRecognition(handleVoiceText)

  function toggleVoice() {
    if (voiceListening) { stopVoice(); return }
    voiceBaseRef.current = title
    startVoice()
  }

  function quickAdd() {
    onQuickAdd(title.trim(), Number.parseInt(minutes, 10))
    setTitle(''); setMinutes('30')
  }

  function resetDetail() {
    setCreateOpen(false)
    setImportance('important'); setSplittable(false); setDeadline('')
    setPlace(''); setNotes(''); setPinTime(''); setError('')
    setRepeat(null); setRepeatDays([])
  }

  function detailedAdd() {
    const cleanTitle = title.trim()
    if (!cleanTitle) { setError('先给它起个名字。'); return }
    if (repeat?.kind === 'weekly' && repeatDays.length === 0) { setError('每周重复至少选一天。'); return }
    const parsed = Number.parseInt(minutes, 10)
    const draft: TaskDraft = {
      title: cleanTitle,
      importance,
      splittable,
      deadlineAt: deadline ? new Date(deadline).toISOString() : undefined,
      place: place || undefined,
      notes: notes || undefined,
      targetDurationMinutes: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
    }
    const created = createTask(draft, new Date().toISOString(), crypto.randomUUID())
    if (!created.task) return
    let task: StoredTask = created.task
    if (pinTime) {
      const pinned = pinTask(task, pinTime, localDate(new Date().toISOString()), 'Asia/Shanghai', new Date().toISOString())
      if (!pinned.task) { setError('这个时间已经过去了，或者时长还没填。'); return }
      task = pinned.task
    }
    onDetailedAdd(task, repeat ? { kind: repeat.kind, weekdays: repeat.kind === 'weekly' ? repeatDays : undefined, startDate: localDate(new Date().toISOString()) } : null)
    setTitle(''); setMinutes('30')
    resetDetail()
  }

  return (
    <>
      <section className="capture" aria-label="快速添加">
        <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') (createOpen ? detailedAdd() : quickAdd()) }} placeholder="加一件事" aria-label="加一件事" />
        <input className="minutes-input" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="预计分钟" inputMode="numeric" />
        <span className="minutes-label">分</span>
        {voiceSupported && <button className={`mic-button ${voiceListening ? 'listening' : ''}`} type="button" aria-label={voiceListening ? '停止听写' : '语音输入'} title={voiceListening ? '停止听写' : '语音输入'} onClick={toggleVoice}>🎙</button>}
        <button className="add-button" type="button" onClick={() => (createOpen ? detailedAdd() : quickAdd())}>加</button>
      </section>
      {voiceError && <p className="voice-error">{voiceError === 'not-allowed' ? '需要麦克风权限才能听写。' : voiceError === 'network' ? '语音服务暂时不可用，检查网络后重试。' : '没听清，再试一次。'}</p>}
      {!createOpen && !blocksOpen && <button className="link-button expand-toggle" type="button" onClick={() => setCreateOpen(true)}>展开详细设置，顺便定好重要性和时间 ▾</button>}
      {!createOpen && !blocksOpen && <button className="link-button expand-toggle" type="button" onClick={onOpenBlocks}>加一段固定日程（会议、课程这类挪不动的时间） ▾</button>}
      {createOpen && <section className="edit-card create-card" aria-label="新任务详细设置">
        <div className="edit-heading"><p className="label">新任务 · 详细设置</p><button className="link-button" type="button" onClick={resetDetail}>收起</button></div>
        <div className="repeat-panel"><span className="edit-hint">重要性</span>{([['must', '必须做'], ['important', '重要'], ['want', '想做']] as Array<[Importance, string]>).map(([value, label]) => <button className={importance === value ? 'choice active' : 'choice'} type="button" key={value} onClick={() => setImportance(value)}>{label}</button>)}</div>
        <div className="repeat-panel"><span className="edit-hint">拆分</span><button className={splittable ? 'choice active' : 'choice'} type="button" onClick={() => setSplittable((value) => !value)}>{splittable ? '可以切小块' : '不切分'}</button><span className="edit-hint">超过 50 分钟的长任务自动按 25 分钟切块</span></div>
        <div className="edit-grid"><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} aria-label="截止时间" /><span className="edit-hint">截止时间，可选</span></div>
        <div className="edit-grid"><input value={place} onChange={(event) => setPlace(event.target.value)} placeholder="在哪里" aria-label="在哪里" /><input type="time" value={pinTime} onChange={(event) => setPinTime(event.target.value)} aria-label="钉在几点" /></div>
        <span className="edit-hint pin-hint">钉在几点，留空表示自动安排</span>
        <div className="repeat-panel">
          <span className="edit-hint">重复</span>
          <button className={repeat?.kind === 'daily' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeat({ kind: 'daily', startDate: localDate(new Date().toISOString()) })}>每天</button>
          <button className={repeat?.kind === 'weekly' ? 'choice active' : 'choice'} type="button" onClick={() => setRepeat({ kind: 'weekly', weekdays: repeatDays, startDate: localDate(new Date().toISOString()) })}>每周</button>
          {repeat?.kind === 'weekly' && <div className="weekday-list">{['日', '一', '二', '三', '四', '五', '六'].map((label, index) => <button className={repeatDays.includes(index) ? 'day active' : 'day'} type="button" key={label} onClick={() => setRepeatDays((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])}>{label}</button>)}</div>}
          {repeat && <span className="edit-hint">会创建一条重复规则，今天生成第一件</span>}
        </div>
        {error && <p className="error-text">{error}</p>}
      </section>}
    </>
  )
}
