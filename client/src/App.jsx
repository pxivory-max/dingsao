import { useState, useEffect, useCallback } from 'react'
import './index.css'

const API = '/api'

// --- Auth helpers ---
function getToken() { return localStorage.getItem('dingsao_token') }
function setToken(t) { if (t) localStorage.setItem('dingsao_token', t); else localStorage.removeItem('dingsao_token') }
function authHeaders() {
  const t = getToken()
  return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } : { 'Content-Type': 'application/json' }
}
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } })
  if (res.status === 401) { setToken(null); window.location.reload(); return null }
  return res.json()
}

// Lightweight visit tracking
try { fetch(`${API}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: location.pathname }) }).catch(() => {}) } catch(e) {}

function formatTime(t) {
  if (!t) return '-'
  const d = new Date(t + 'Z')
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

function StatusBadge({ status }) {
  const colors = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700'
  }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>{status}</span>
}

// --- Auth Page ---
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
      const body = mode === 'login' ? { email: form.email, password: form.password } : form
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setToken(data.data.token)
      onLogin(data.data.user)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🔭</div>
          <h1 className="text-2xl font-bold text-gray-900">盯梢</h1>
          <p className="text-sm text-gray-500 mt-1">AI 信息雷达</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex mb-5 border-b">
            <button onClick={() => { setMode('login'); setError('') }} className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${mode === 'login' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>登录</button>
            <button onClick={() => { setMode('register'); setError('') }} className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${mode === 'register' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>注册</button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="你的名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="email@example.com" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder={mode === 'register' ? '至少 6 位' : '密码'} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={mode === 'register' ? 6 : undefined} />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? '请稍候...' : mode === 'login' ? '登录' : '注册'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// --- Add Monitor Dialog ---
function AddMonitorDialog({ open, onClose, onCreated, editMonitor }) {
  const [form, setForm] = useState({ name: '', url: '', selector: '', frequency: 60, keywords: '' })
  const isEdit = !!editMonitor

  useEffect(() => {
    if (editMonitor) {
      setForm({
        name: editMonitor.name || '',
        url: editMonitor.url || '',
        selector: editMonitor.selector || '',
        frequency: editMonitor.frequency || 60,
        keywords: editMonitor.keywords || ''
      })
    } else {
      setForm({ name: '', url: '', selector: '', frequency: 60, keywords: '' })
    }
  }, [editMonitor, open])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const url = isEdit ? `/monitors/${editMonitor.id}` : `/monitors`
      const method = isEdit ? 'PUT' : 'POST'
      const data = await apiFetch(url, { method, body: JSON.stringify(form) })
      if (!data || !data.success) throw new Error(data?.error || '请求失败')
      onCreated(data.data)
      setForm({ name: '', url: '', selector: '', frequency: 60, keywords: '' })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">{isEdit ? '编辑监控' : '添加监控'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="如：竞品官网价格页" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">网址 *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://example.com/pricing" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} required type="url" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CSS 选择器 <span className="text-gray-400">(可选，只监控页面特定区域)</span></label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="如：.pricing-table 或 #main-content" value={form.selector} onChange={e => setForm({ ...form, selector: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">检查频率（分钟）</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.frequency} onChange={e => setForm({ ...form, frequency: parseInt(e.target.value) })}>
              <option value={15}>每 15 分钟</option>
              <option value={30}>每 30 分钟</option>
              <option value={60}>每小时</option>
              <option value={360}>每 6 小时</option>
              <option value={1440}>每天</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关键词过滤 <span className="text-gray-400">(可选)</span></label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="输入关键词，逗号分隔（留空=所有变化都通知）" value={form.keywords} onChange={e => setForm({ ...form, keywords: e.target.value })} />
            <p className="text-xs text-gray-400 mt-1">设置后只有包含关键词的变化才会触发通知</p>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">取消</button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {loading ? (isEdit ? '保存中...' : '创建中...') : (isEdit ? '保存' : '开始监控')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// --- Change Detail Dialog ---
function ChangeDetailDialog({ change, onClose }) {
  if (!change) return null
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">变化详情</h2>
        <p className="text-sm text-gray-500 mb-4">{formatTime(change.detected_at)}</p>
        <div className="bg-blue-50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-blue-800 mb-1">AI 摘要</h3>
          <p className="text-sm text-blue-700">{change.ai_summary || '无摘要'}</p>
        </div>
        {change.old_content && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-600 mb-1">旧内容（前500字）</h3>
            <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">{change.old_content?.substring(0, 500)}</pre>
          </div>
        )}
        {change.new_content && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-600 mb-1">新内容（前500字）</h3>
            <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">{change.new_content?.substring(0, 500)}</pre>
          </div>
        )}
        <button onClick={onClose} className="w-full px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">关闭</button>
      </div>
    </div>
  )
}

// --- Settings Dialog (Multi-tab) ---
function SettingsDialog({ open, onClose, onSettingsChange }) {
  const [tab, setTab] = useState('feishu')
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState('')
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    if (open) {
      apiFetch('/settings').then(d => {
        if (d && d.success) setSettings(d.data || {})
      })
      setSaved(false)
      setTestResult(null)
    }
  }, [open])

  if (!open) return null

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }))

  const handleSave = async () => {
    setLoading(true)
    await apiFetch('/settings/batch', {
      method: 'POST',
      body: JSON.stringify({ settings })
    })
    setLoading(false)
    setSaved(true)
    if (onSettingsChange) onSettingsChange(settings)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async (type) => {
    setTesting(type)
    setTestResult(null)
    try {
      // Save first
      await apiFetch('/settings/batch', {
        method: 'POST',
        body: JSON.stringify({ settings })
      })
      const data = await apiFetch('/settings/test-notification', {
        method: 'POST',
        body: JSON.stringify({ type })
      })
      setTestResult(data && data.success ? { ok: true, msg: '✅ 发送成功！' } : { ok: false, msg: data?.error || '发送失败' })
    } catch (e) {
      setTestResult({ ok: false, msg: e.message })
    } finally {
      setTesting('')
    }
  }

  const tabs = [
    { key: 'feishu', label: '飞书 Webhook', icon: '🐦' },
    { key: 'webhook', label: '通用 Webhook', icon: '🔗' },
    { key: 'email', label: '邮件通知', icon: '✉️' }
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">⚙️ 通知设置</h2>

        {/* Tabs */}
        <div className="flex border-b mb-4">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setTestResult(null) }}
              className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Feishu Tab */}
        {tab === 'feishu' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">飞书 Webhook URL</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
                value={settings.feishu_webhook || ''}
                onChange={e => update('feishu_webhook', e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">在飞书群添加自定义机器人，复制 Webhook 地址粘贴到此处</p>
            </div>
            <button
              onClick={() => handleTest('feishu')}
              disabled={!settings.feishu_webhook || testing === 'feishu'}
              className="w-full px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing === 'feishu' ? '发送中...' : '📨 测试发送'}
            </button>
          </div>
        )}

        {/* Webhook Tab */}
        {tab === 'webhook' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">通用 Webhook URL</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="https://your-server.com/webhook"
                value={settings.webhook_url || ''}
                onChange={e => update('webhook_url', e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">变化检测到后会 POST JSON 到该地址，包含 monitor_name, monitor_url, summary, detected_at</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-600 mb-1">POST Body 示例：</p>
              <pre className="text-xs text-gray-500">{`{
  "monitor_name": "竞品官网",
  "monitor_url": "https://...",
  "summary": "AI摘要内容",
  "detected_at": "2026-04-15T12:00:00Z"
}`}</pre>
            </div>
            <button
              onClick={() => handleTest('webhook')}
              disabled={!settings.webhook_url || testing === 'webhook'}
              className="w-full px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing === 'webhook' ? '发送中...' : '📨 测试发送'}
            </button>
          </div>
        )}

        {/* Email Tab */}
        {tab === 'email' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">收件邮箱</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="your@email.com"
                value={settings.email_to || ''}
                onChange={e => update('email_to', e.target.value)}
                type="email"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP 服务器</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="col-span-2 border rounded-lg px-3 py-2 text-sm"
                  placeholder="smtp.gmail.com"
                  value={settings.smtp_host || ''}
                  onChange={e => update('smtp_host', e.target.value)}
                />
                <input
                  className="border rounded-lg px-3 py-2 text-sm"
                  placeholder="587"
                  value={settings.smtp_port || ''}
                  onChange={e => update('smtp_port', e.target.value)}
                  type="number"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP 用户名</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="your@gmail.com"
                value={settings.smtp_user || ''}
                onChange={e => update('smtp_user', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP 密码 / 应用密码</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="应用专用密码"
                value={settings.smtp_pass || ''}
                onChange={e => update('smtp_pass', e.target.value)}
                type="password"
              />
              <p className="text-xs text-gray-400 mt-1">Gmail 用户请使用「应用专用密码」，非账号密码</p>
            </div>
            <button
              onClick={() => handleTest('email')}
              disabled={!settings.email_to || !settings.smtp_host || !settings.smtp_user || !settings.smtp_pass || testing === 'email'}
              className="w-full px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing === 'email' ? '发送中...' : '📨 测试发送'}
            </button>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`mt-3 p-2 rounded-lg text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {testResult.msg}
          </div>
        )}

        <div className="flex gap-2 pt-4">
          <button onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">取消</button>
          <button onClick={handleSave} disabled={loading} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {saved ? '✅ 已保存' : loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Monitor Detail View ---
function MonitorDetail({ monitor, onBack, onEdit }) {
  const [changes, setChanges] = useState([])
  const [totalChanges, setTotalChanges] = useState(0)
  const [filteredChanges, setFilteredChanges] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [selectedChange, setSelectedChange] = useState(null)

  useEffect(() => { loadChanges() }, [monitor.id, showAll])

  const loadChanges = async () => {
    setLoading(true)
    const qs = showAll ? '?all=1' : ''
    const data = await apiFetch(`/monitors/${monitor.id}/changes${qs}`)
    if (data && data.success) {
      setChanges(data.data.changes)
      setTotalChanges(data.data.totalChanges ?? 0)
      setFilteredChanges(data.data.filteredChanges ?? 0)
    }
    setLoading(false)
  }

  const triggerCheck = async () => {
    setChecking(true)
    await apiFetch(`/monitors/${monitor.id}/check`, { method: 'POST' })
    await loadChanges()
    setChecking(false)
  }

  const loadChangeDetail = async (changeId) => {
    const data = await apiFetch(`/changes/${changeId}`)
    if (data && data.success) setSelectedChange(data.data)
  }

  return (
    <div>
      <button onClick={onBack} className="text-blue-600 text-sm mb-4 hover:underline">← 返回列表</button>
      <div className="bg-white rounded-xl border p-5 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{monitor.name}</h2>
            <a href={monitor.url} target="_blank" rel="noopener" className="text-sm text-blue-500 hover:underline break-all">{monitor.url}</a>
            <div className="flex gap-3 mt-2 text-sm text-gray-500">
              <span>频率: {monitor.frequency}分钟</span>
              {monitor.selector && <span>选择器: <code className="bg-gray-100 px-1 rounded">{monitor.selector}</code></span>}
              <StatusBadge status={monitor.status} />
            </div>
            {monitor.keywords && <p className="text-sm text-gray-500 mt-1">🌟 关键词: <span className="bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded text-xs">{monitor.keywords}</span></p>}
            {monitor.error_message && <p className="text-sm text-red-500 mt-1">{monitor.error_message}</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => onEdit && onEdit(monitor)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">编辑</button>
            <button onClick={triggerCheck} disabled={checking} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {checking ? '检查中...' : '立即检查'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">
          变化历史
          {filteredChanges > 0
            ? <span className="text-sm font-normal text-gray-500 ml-2">显示 {totalChanges - filteredChanges} 条，已过滤 {filteredChanges} 条（共 {totalChanges} 条）</span>
            : <span className="text-sm font-normal text-gray-500 ml-2">({totalChanges})</span>
          }
        </h3>
        {filteredChanges > 0 && (
          <button onClick={() => setShowAll(!showAll)} className="text-xs text-blue-600 hover:underline">
            {showAll ? '只看匹配的' : '显示全部'}
          </button>
        )}
      </div>
      {loading ? (
        <p className="text-gray-400 text-sm">加载中...</p>
      ) : changes.length === 0 ? (
        <div className="bg-gray-50 rounded-xl p-8 text-center text-gray-400">
          <p className="text-lg mb-1">暂无变化记录</p>
          <p className="text-sm">系统正在监控中，有变化时会自动记录</p>
        </div>
      ) : (
        <div className="space-y-2">
          {changes.map(c => (
            <div key={c.id} onClick={() => loadChangeDetail(c.id)} className={`bg-white rounded-lg border p-4 cursor-pointer hover:border-blue-300 transition-colors ${c.filtered ? 'opacity-60' : ''}`}>
              <div className="flex justify-between items-start">
                <p className="text-sm flex-1">
                  {c.filtered ? <span className="inline-block bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded mr-1.5">已过滤</span> : null}
                  {c.ai_summary || '(无摘要)'}
                </p>
                <span className="text-xs text-gray-400 shrink-0 ml-4">{formatTime(c.detected_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <ChangeDetailDialog change={selectedChange} onClose={() => setSelectedChange(null)} />
    </div>
  )
}

// --- Notification Guide Banner ---
function NotifyBanner({ onOpenSettings }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
      <span className="text-sm text-amber-800">💡 配置通知后，有变化会自动推送给你</span>
      <button onClick={onOpenSettings} className="text-sm text-amber-700 font-medium hover:text-amber-900 shrink-0 ml-3">去设置 →</button>
    </div>
  )
}

// --- Main App ---
export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [monitors, setMonitors] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedMonitor, setSelectedMonitor] = useState(null)
  const [editingMonitor, setEditingMonitor] = useState(null)
  const [hasNotifyConfig, setHasNotifyConfig] = useState(true)

  // Check token on mount
  useEffect(() => {
    const token = getToken()
    if (token) {
      apiFetch('/auth/me').then(d => {
        if (d && d.success) setUser(d.data)
        else setToken(null)
        setAuthChecked(true)
      })
    } else {
      setAuthChecked(true)
    }
  }, [])

  useEffect(() => { if (user) loadData() }, [user])

  const loadData = async () => {
    setLoading(true)
    const [mRes, sRes, settingsRes] = await Promise.all([
      apiFetch('/monitors'),
      apiFetch('/stats'),
      apiFetch('/settings')
    ])
    if (mRes && mRes.success) setMonitors(mRes.data)
    if (sRes && sRes.success) setStats(sRes.data)
    if (settingsRes && settingsRes.success) {
      const s = settingsRes.data
      setHasNotifyConfig(!!(s.feishu_webhook || s.webhook_url || s.email_to))
    }
    setLoading(false)
  }

  const deleteMonitor = async (id, e) => {
    e.stopPropagation()
    if (!confirm('确定删除这个监控？')) return
    await apiFetch(`/monitors/${id}`, { method: 'DELETE' })
    loadData()
  }

  const handleLogout = () => {
    setToken(null)
    setUser(null)
    setMonitors([])
    setStats(null)
  }

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">加载中...</div>
  }

  if (!user) {
    return <AuthPage onLogin={(u) => setUser(u)} />
  }

  if (selectedMonitor) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <MonitorDetail monitor={selectedMonitor} onBack={() => { setSelectedMonitor(null); loadData() }} onEdit={(m) => { setEditingMonitor(m); setShowAdd(true) }} />
          <AddMonitorDialog open={showAdd} onClose={() => { setShowAdd(false); setEditingMonitor(null) }} editMonitor={editingMonitor} onCreated={(updated) => { setSelectedMonitor(updated); loadData() }} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">🔭 盯梢</h1>
            <p className="text-sm text-gray-500 mt-0.5">AI 信息雷达 — 帮你盯着互联网的变化</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{user.name}</span>
            <button onClick={() => setShowSettings(true)} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50" title="设置">⚙️</button>
            <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm">
              + 添加监控
            </button>
            <button onClick={handleLogout} className="px-3 py-2 border rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-red-500" title="退出登录">退出</button>
          </div>
        </div>

        {/* Notification Guide Banner */}
        {!loading && !hasNotifyConfig && (
          <NotifyBanner onOpenSettings={() => setShowSettings(true)} />
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: '监控总数', value: stats.totalMonitors, color: 'blue' },
              { label: '运行中', value: stats.activeMonitors, color: 'green' },
              { label: '总变化', value: stats.totalChanges, color: 'purple' },
              { label: '24h 变化', value: stats.recentChanges, color: 'orange' }
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border p-3 text-center">
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Monitor List */}
        {loading ? (
          <p className="text-gray-400 text-center py-8">加载中...</p>
        ) : monitors.length === 0 ? (
          <div className="bg-white rounded-xl border p-12 text-center">
            <p className="text-4xl mb-3">🔭</p>
            <p className="text-lg font-medium text-gray-700">还没有监控任务</p>
            <p className="text-sm text-gray-400 mt-1 mb-4">试试添加一个你经常刷的网页，比如竞品官网、招聘页面、行业论坛</p>
            <button onClick={() => setShowAdd(true)} className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm">
              + 添加第一个监控
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {monitors.map(m => (
              <div key={m.id} onClick={() => setSelectedMonitor(m)} className="bg-white rounded-xl border p-4 cursor-pointer hover:border-blue-300 transition-colors group">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="text-sm text-gray-400 truncate mt-0.5">{m.url}</p>
                    <div className="flex gap-3 mt-1 text-xs text-gray-400">
                      <span>频率: {m.frequency}分钟</span>
                      <span>上次检查: {formatTime(m.last_check_at)}</span>
                    </div>
                  </div>
                  <button onClick={(e) => deleteMonitor(m.id, e)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm px-2">删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <AddMonitorDialog open={showAdd} onClose={() => { setShowAdd(false); setEditingMonitor(null) }} editMonitor={editingMonitor} onCreated={() => loadData()} />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} onSettingsChange={(s) => setHasNotifyConfig(!!(s.feishu_webhook || s.webhook_url || s.email_to))} />
    </div>
  )
}
