import type { StatsFacts } from '../../../../packages/core/src'

interface StatsSectionProps {
  facts: StatsFacts
}

const BAR_COLOR: Record<string, string> = { must: 'var(--error)', important: 'var(--accent)', want: 'var(--info)' }
const IMPORTANCE_LABEL: Record<string, string> = { must: '必须', important: '重要', want: '想做' }

export function StatsSection({ facts }: StatsSectionProps) {
  const maxCompleted = Math.max(...facts.days.map((d) => d.completed), 1)
  const totalOpen = facts.openByImportance.must + facts.openByImportance.important + facts.openByImportance.want
  return (
    <section className="settings-section" aria-label="统计看板">
      <p className="label">STATS / 数据看板</p><h2>近 14 天</h2>
      <p className="settings-copy">不算完成率，不排名次。只是让你看见自己走过的路。</p>
      <div className="stats-chart" aria-label="每日完成柱状图">
        {facts.days.map((day) => (
          <div className="stats-bar-col" key={day.date}>
            <div className="stats-bar" style={{ height: `${Math.max(4, (day.completed / maxCompleted) * 80)}px` }} data-count={day.completed}>
              {day.completed > 0 && <span className="stats-bar-count">{day.completed}</span>}
            </div>
            <small>{day.label}</small>
          </div>
        ))}
      </div>
      <p className="settings-copy" style={{ marginTop: 14 }}>当前未完成的任务：</p>
      <div className="stats-dist">
        {(['must', 'important', 'want'] as const).map((key) => (
          <span className="stats-dist-item" key={key}>
            <span className="stats-dot" style={{ background: BAR_COLOR[key] }} />
            {IMPORTANCE_LABEL[key]} {facts.openByImportance[key]}
          </span>
        ))}
        <span className="stats-dist-total">共 {totalOpen} 件</span>
      </div>
      <p className="settings-copy" style={{ marginTop: 14 }}>累计完成：{facts.totalCompleted} 件。</p>
    </section>
  )
}
