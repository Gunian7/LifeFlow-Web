import type { ThemeId } from '../../../../packages/core/src'
import { getTheme, themeIds } from '../../../../packages/core/src'

interface HeaderProps {
  tagline: { text: string; from?: string }
  today: string
  themeId: ThemeId
  onThemeChange: (id: ThemeId) => void
  showAll: boolean
  onToggleShowAll: () => void
  onOpenSettings: () => void
}

export function Header({ tagline, today, themeId, onThemeChange, showAll, onToggleShowAll, onOpenSettings }: HeaderProps) {
  return (
    <header className="header">
      <div>
        <p className="eyebrow">LIFEFLOW</p>
        <div className="tagline-block">
          <h1>{tagline.text}</h1>
          {tagline.from && <span className="tagline-from">——{tagline.from}</span>}
        </div>
        <p className="date">{today}</p>
      </div>
      <div className="header-actions">
        <label className="theme-control"><span>皮肤</span><select aria-label="切换皮肤" value={themeId} onChange={(event) => onThemeChange(event.target.value as ThemeId)}>{themeIds.map((id) => <option value={id} key={id}>{getTheme(id).name}</option>)}</select></label>
        <button className="ghost-button" type="button" onClick={onToggleShowAll}>{showAll ? '只看今天' : '全部任务'}</button>
        <button className="ghost-button" type="button" onClick={onOpenSettings}>设置</button>
      </div>
    </header>
  )
}
