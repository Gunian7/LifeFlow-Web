import { useEffect, useState } from 'react'
import { loginAccount, logoutAccount, registerAccount } from '../account'

interface AccountSectionProps {
  accountEmail: string | null
  apiBaseUrl: string
  onChanged: () => void
}

interface PlanInfo { plan: string; planExpiresAt: string | null }

const PLAN_LABEL: Record<string, string> = { free: '免费版', monthly: '月度版', yearly: '年度版' }

export function AccountSection({ accountEmail, apiBaseUrl, onChanged }: AccountSectionProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'info' | 'ok' | 'fail'>('info')
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemBusy, setRedeemBusy] = useState(false)
  const [redeemNotice, setRedeemNotice] = useState('')
  const [redeemTone, setRedeemTone] = useState<'ok' | 'fail'>('ok')

  useEffect(() => {
    if (!accountEmail) return
    const token = localStorage.getItem('lifeflow-auth-token-v1')
    if (!token) return
    fetch(`${apiBaseUrl}/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { if (data.ok) setPlanInfo({ plan: data.plan, planExpiresAt: data.planExpiresAt }) })
      .catch(() => {})
  }, [accountEmail, apiBaseUrl, onChanged])

  const planLabel = PLAN_LABEL[planInfo?.plan ?? 'free'] ?? '免费版'

  async function submit(kind: 'login' | 'register') {
    setBusy(true); setNotice('')
    try {
      const action = kind === 'login' ? loginAccount : registerAccount
      await action(apiBaseUrl, email.trim(), password)
      onChanged()
      setNoticeTone('ok'); setNotice(kind === 'login' ? '已登录。' : '注册成功，已登录。')
      setPassword('')
    } catch (error) {
      const code = (error as { code?: string }).code
      setNoticeTone('fail')
      setNotice(code === 'EMAIL_TAKEN' ? '这个邮箱已经注册过，直接登录就好。' : code === 'BAD_CREDENTIALS' ? '邮箱或密码不对。' : '请填写邮箱和至少 8 位的密码。')
    } finally {
      setBusy(false)
    }
  }

  function logout() {
    logoutAccount(apiBaseUrl)
    onChanged()
    setNoticeTone('info'); setNotice('已退出登录。')
  }

  async function doRedeem() {
    const code = redeemCode.trim()
    if (!code) return
    setRedeemBusy(true); setRedeemNotice('')
    const token = localStorage.getItem('lifeflow-auth-token-v1')
    if (!token) { setRedeemTone('fail'); setRedeemNotice('请先登录。'); return }
    try {
      const response = await fetch(`${apiBaseUrl}/v1/auth/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ code }) })
      const data = await response.json() as { ok?: boolean; error?: string; plan?: string; days?: number }
      if (!response.ok || !data.ok) {
        setRedeemTone('fail')
        setRedeemNotice(data.error === 'CODE_INVALID_OR_USED' ? '兑换码无效或已被使用。' : '兑换失败，请检查后重试。')
        return
      }
      setRedeemTone('ok')
      setRedeemNotice(`兑换成功！已开通 ${data.plan === 'monthly' ? '月度' : '年度'}套餐（${data.days} 天）。`)
      setRedeemCode('')
      onChanged()
    } catch {
      setRedeemTone('fail'); setRedeemNotice('网络异常，请稍后重试。')
    }
  }

  if (accountEmail) {
    return (
      <section className="settings-section" aria-label="账号设置">
        <p className="label">ACCOUNT / 账号</p><h2>账号</h2>
        <p className="settings-copy">已登录：{accountEmail}。AI 额度跟着账号走，换设备登录也有效。本地任务数据仍然只保存在这台设备上。</p>
        <p className="settings-copy plan-line">当前套餐：{planLabel}</p>
        <div className="settings-actions"><button className="secondary-button" type="button" onClick={logout}>退出登录</button></div>
      </section>
    )
  }

  return (
    <section className="settings-section" aria-label="账号设置">
      <p className="label">ACCOUNT / 账号</p><h2>账号</h2>
      <p className="settings-copy">登录后，AI 额度跟着账号走，换设备登录也有效。本地任务数据仍然只保存在这台设备上。</p>
      <p className="settings-copy plan-line">当前套餐：{planLabel}。</p>
      <div className="api-field"><p className="label">邮箱</p><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" aria-label="邮箱" /></div>
      <div className="api-field"><p className="label">密码（至少 8 位）</p><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-label="密码" /></div>
      <div className="settings-actions">
        <button className="secondary-button" type="button" onClick={() => submit('register')} disabled={busy}>注册并登录</button>
        <button className="secondary-button" type="button" onClick={() => submit('login')} disabled={busy}>登录</button>
      </div>
      {notice && <p className="import-notice" style={{ color: noticeTone === 'ok' ? 'var(--success)' : noticeTone === 'fail' ? 'var(--error)' : undefined }}>{notice}</p>}
      <div className="redeem-section">
        <p className="label" style={{ marginTop: 14 }}>兑换码</p>
        <div className="redeem-row-wrap">
          <input className="redeem-input" value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} placeholder="输入兑换码" aria-label="兑换码" />
          <button className="secondary-button" type="button" onClick={doRedeem} disabled={redeemBusy || !redeemCode.trim()}>{redeemBusy ? '核销中……' : '兑换'}</button>
        </div>
        {redeemNotice && <p className="import-notice" style={{ color: redeemTone === 'ok' ? 'var(--success)' : redeemTone === 'fail' ? 'var(--error)' : undefined }}>{redeemNotice}</p>}
      </div>
    </section>
  )
}
