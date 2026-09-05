import type { ReactNode, RefObject } from 'react'
import type { RecurrenceRule, RecurringTemplate, ThemeId } from '../../../../packages/core/src'
import { getTheme, themeIds } from '../../../../packages/core/src'
import { AccountSection } from './AccountSection'

export type SettingsSection = 'appearance' | 'planning' | 'account' | 'repeat' | 'data' | 'ai' | 'about'

function validTime(value: unknown): string | null {
  return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value) ? value : null
}

function ruleText(rule: RecurrenceRule): string {
  if (rule.kind === 'daily') return '每天'
  return '每周 ' + (rule.weekdays ?? []).map((day: number) => '日一二三四五六'[day]).join('、')
}

const SECTION_ITEMS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'planning', label: '计划' },
  { id: 'account', label: '账号' },
  { id: 'repeat', label: '重复' },
  { id: 'data', label: '数据' },
  { id: 'ai', label: 'AI 与服务' },
  { id: 'about', label: '关于 LifeFlow' },
]

export interface SettingsPageProps {
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onBack: () => void
  // The appearance section is built by the App because it is wired into the
  // background/crop state; everything else lives here.
  appearanceSection: ReactNode
  planner: { start: string; end: string; bufferMinutes: number; restEnabled: boolean; restStart: string; restEnd: string }
  onPlannerChange: (patch: Partial<{ start: string; end: string; bufferMinutes: number; restEnabled: boolean; restStart: string; restEnd: string }>) => void
  templates: RecurringTemplate[]
  onTemplatesChange: (update: (current: RecurringTemplate[]) => RecurringTemplate[]) => void
  apiDraft: string
  onApiDraftChange: (value: string) => void
  apiNotice: string
  apiNoticeTone: 'info' | 'ok' | 'fail'
  apiTesting: boolean
  defaultApiUrl: string
  onApiSave: () => void
  onApiTest: () => void
  accountEmail: string | null
  apiBaseUrl: string
  onAccountChanged: () => void
  importNotice: string
  importInputRef: RefObject<HTMLInputElement | null>
  onExport: () => void
  onImport: (file: File) => void
  onDeleteAll: () => void
}

export function SettingsPage(props: SettingsPageProps) {
  return (
    <main className="shell settings-page">
      <header className="header">
        <div><p className="eyebrow">LIFEFLOW / SYSTEM</p><h1>设置</h1><p className="date">调整 LifeFlow 的工作方式</p></div>
        <button className="ghost-button back-plan" type="button" onClick={props.onBack}>返回计划</button>
      </header>
      <section className="settings-workspace" aria-label="设置工作区">
        <nav className="settings-nav" aria-label="设置分类">
          <p className="settings-nav-title">SYSTEM</p>
          {SECTION_ITEMS.map((item) => <button className={`settings-nav-item ${props.section === item.id ? 'selected' : ''}`} type="button" key={item.id} onClick={() => props.onSectionChange(item.id)}>{item.label}<span aria-hidden="true">›</span></button>)}
        </nav>
        <div className="settings-content">
          {props.section === 'appearance' && props.appearanceSection}
          {props.section === 'planning' && <section className="settings-section" aria-label="计划设置"><p className="label">PLANNING / 计划</p><h2>今天的时间</h2><p className="settings-copy">下面的默认值只是示例，按你的现实来改。排程用这里的时间决定可用窗口、缓冲和休息；AI 也会参考它。</p><div className="planner-form"><label>可用时段从<input type="time" value={props.planner.start} onChange={(event) => { if (validTime(event.target.value)) props.onPlannerChange({ start: event.target.value }) }} />到<input type="time" value={props.planner.end} onChange={(event) => { if (validTime(event.target.value)) props.onPlannerChange({ end: event.target.value }) }} /></label><label>每日缓冲<input type="number" min={0} max={300} value={props.planner.bufferMinutes} onChange={(event) => props.onPlannerChange({ bufferMinutes: Number(event.target.value) })} /><span>分钟</span></label><label className="checkbox-line"><input type="checkbox" checked={props.planner.restEnabled} onChange={(event) => props.onPlannerChange({ restEnabled: event.target.checked })} />保护休息时段</label>{props.planner.restEnabled && <label>休息从<input type="time" value={props.planner.restStart} onChange={(event) => { if (validTime(event.target.value)) props.onPlannerChange({ restStart: event.target.value }) }} />到<input type="time" value={props.planner.restEnd} onChange={(event) => { if (validTime(event.target.value)) props.onPlannerChange({ restEnd: event.target.value }) }} /></label>}</div></section>}
          {props.section === 'account' && <AccountSection accountEmail={props.accountEmail} apiBaseUrl={props.apiBaseUrl} onChanged={props.onAccountChanged} />}
          {props.section === 'repeat' && <section className="settings-section" aria-label="重复任务设置"><p className="label">REPEAT / 重复</p><h2>重复任务</h2><p className="settings-copy">暂停的模板不再生成新任务，随时恢复；删除模板不影响已经生成的任务。</p>{props.templates.length === 0 && <p className="settings-copy">还没有重复任务。在编辑或添加任务时选择"每天"或"每周"就能创建。</p>}{props.templates.map((template) => <div className="template-row" key={template.id}><span className="template-title">{template.title}{template.paused && <small>已暂停</small>}</span><small className="template-rule">{ruleText(template.rule)}</small><span className="decision-actions">{template.paused ? <button className="link-button" type="button" onClick={() => props.onTemplatesChange((current) => current.map((item) => item.id === template.id ? { ...item, paused: false } : item))}>恢复</button> : <button className="link-button" type="button" onClick={() => props.onTemplatesChange((current) => current.map((item) => item.id === template.id ? { ...item, paused: true } : item))}>暂停</button>}<button className="link-button" type="button" onClick={() => { if (window.confirm('删除这条重复规则？已生成的任务会保留。')) props.onTemplatesChange((current) => current.filter((item) => item.id !== template.id)) }}>删除</button></span></div>)}</section>}
          {props.section === 'data' && <section className="settings-section" aria-label="数据设置"><p className="label">DATA / 数据</p><h2>本地数据</h2><p className="settings-copy">任务保存在这台设备的浏览器里。没有账号，也不会自动上传。导入时，相同任务会保留更新时间较新的一份。</p><input ref={props.importInputRef} className="file-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onImport(file); event.currentTarget.value = '' }} /><div className="settings-actions"><button className="secondary-button" type="button" onClick={props.onExport}>导出数据</button><button className="secondary-button" type="button" onClick={() => props.importInputRef.current?.click()}>导入数据</button><button className="danger-button" type="button" onClick={props.onDeleteAll}>删除全部数据</button></div>{props.importNotice && <p className="import-notice">{props.importNotice}</p>}</section>}
          {props.section === 'ai' && <section className="settings-section" aria-label="AI 与服务设置"><p className="label">AI / AI 与服务</p><h2>AI 顾问</h2><p className="settings-copy">AI 建议会在你明确请求时使用。它只能提供顺序建议，不能替代本地 Planner，也不会自动修改你的计划。</p><p className="settings-copy">也可以接入自己的后端：只要提供 GET /health 和 POST /v1/ai/order（返回的顺序必须恰好包含每个任务 id 一次，并附一句理由），LifeFlow 就把请求发到你的服务。</p><div className="api-field"><p className="label">服务地址</p><input value={props.apiDraft} onChange={(event) => props.onApiDraftChange(event.target.value)} placeholder={props.defaultApiUrl} aria-label="后端服务地址" /></div><div className="settings-actions"><button className="secondary-button" type="button" onClick={props.onApiSave}>保存</button><button className="secondary-button" type="button" onClick={props.onApiTest} disabled={props.apiTesting}>测试连接</button></div>{props.apiNotice && <p className="import-notice" style={{ color: props.apiNoticeTone === 'ok' ? 'var(--success)' : props.apiNoticeTone === 'fail' ? 'var(--error)' : undefined }}>{props.apiNotice}</p>}</section>}
          {props.section === 'about' && <section className="settings-section settings-placeholder" aria-label="关于 LifeFlow"><p className="label">ABOUT / 关于</p><h2>LifeFlow</h2><p className="settings-copy">一个帮助你重新进入生活的现实型时间规划工具。</p><span className="muted">本地优先 · 无需登录 · 计划可解释</span></section>}
        </div>
      </section>
    </main>
  )
}
