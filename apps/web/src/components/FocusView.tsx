import type { FocusSession } from '../../../../packages/core/src/focus'

interface FocusViewProps {
  session: FocusSession
  taskTitle: string
  remaining: number
  onPauseToggle: () => void
  onEnd: () => void
}

export function FocusView({ session, taskTitle, remaining, onPauseToggle, onEnd }: FocusViewProps) {
  const total = Math.max(1, session.durationMinutes * 60)
  const progress = Math.min(1, Math.max(0, 1 - remaining / total))
  const ringLength = 2 * Math.PI * 120
  return (
    <main className="focus-mode" aria-label="专注中">
      <p className="focus-task">正在做：{taskTitle}</p>
      <div className={`breath-ring ${session.state === 'paused' ? 'is-paused' : ''}`}>
        <svg viewBox="0 0 260 260" aria-hidden="true">
          <circle className="ring-track" cx="130" cy="130" r="120" />
          <circle className="ring-progress" cx="130" cy="130" r="120" strokeDasharray={ringLength} strokeDashoffset={ringLength * (1 - progress)} />
        </svg>
        <p className="focus-timer-big">{Math.floor(remaining / 60).toString().padStart(2, '0')}:{(remaining % 60).toString().padStart(2, '0')}</p>
      </div>
      <div className="focus-actions">
        <button className="secondary-button" type="button" onClick={onPauseToggle}>{session.state === 'running' ? '暂停' : '继续'}</button>
        <button className="link-button" type="button" onClick={onEnd}>结束专注</button>
      </div>
      <p className="focus-note">这段时间本身就是计划的一部分。</p>
    </main>
  )
}
