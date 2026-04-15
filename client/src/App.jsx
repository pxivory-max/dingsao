import { useState, useEffect } from 'react'
import './index.css'

const API = '/api'

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

// --- Add Monitor Dialog ---
function AddMonitorDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', url: '', selector: '', frequency: 60 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/monitors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      onCreated(data.data)
      setForm({ name: '', url: '', selector: '', frequency: 60 })
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
        <h2 className="text-lg font-bold mb-4">添加监控</h2>
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
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">取消</button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {loading ? '创建中...' : '开始监控'}
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

// --- Settings Dialog ---
function SettingsDialog({ open, onClose }) {
  const [webhook, setWebhook] = useState('')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      fetch(`${API}/settings`).then(r => r.json()).then(d => {
        if (d.success) setWebhook(d.data.feishu_webhook || '')
      })
    }
  }, [open])

  if (!open) return null

  const handleSave = async () => {
    setLoading(true)
    await fetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'feishu_webhook', value: webhook })
    })
    setLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">⚙️ 设置</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">飞书 Webhook URL</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx" value={webhook} onChange={e => setWebhook(e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">配置后，监控到变化会自动发送飞书通知</p>
          </div>
        </div>
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
function MonitorDetail({ monitor, onBack }) {
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [selectedChange, setSelectedChange] = useState(null)

  useEffect(() => { loadChanges() }, [monitor.id])

  const loadChanges = async () => {
    setLoading(true)
    const res = await fetch(`${API}/monitors/${monitor.id}/changes`)
    const data = await res.json()
    if (data.success) setChanges(data.data.changes)
    setLoading(false)
  }

  const triggerCheck = async () => {
    setChecking(true)
    await fetch(`${API}/monitors/${monitor.id}/check`, { method: 'POST' })
    await loadChanges()
    setChecking(false)
  }

  const loadChangeDetail = async (changeId) => {
    const res = await fetch(`${API}/changes/${changeId}`)
    const data = await res.json()
    if (data.success) setSelectedChange(data.data)
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
            {monitor.error_message && <p className="text-sm text-red-500 mt-1">{monitor.error_message}</p>}
          </div>
          <button onClick={triggerCheck} disabled={checking} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 shrink-0">
            {checking ? '检查中...' : '立即检查'}
          </button>
        </div>
      </div>

      <h3 className="font-semibold mb-3">变化历史 ({changes.length})</h3>
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
            <div key={c.id} onClick={() => loadChangeDetail(c.id)} className="bg-white rounded-lg border p-4 cursor-pointer hover:border-blue-300 transition-colors">
              <div className="flex justify-between items-start">
                <p className="text-sm flex-1">{c.ai_summary || '(无摘要)'}</p>
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

// --- Main App ---
export default function App() {
  const [monitors, setMonitors] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedMonitor, setSelectedMonitor] = useState(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    const [mRes, sRes] = await Promise.all([
      fetch(`${API}/monitors`).then(r => r.json()),
      fetch(`${API}/stats`).then(r => r.json())
    ])
    if (mRes.success) setMonitors(mRes.data)
    if (sRes.success) setStats(sRes.data)
    setLoading(false)
  }

  const deleteMonitor = async (id, e) => {
    e.stopPropagation()
    if (!confirm('确定删除这个监控？')) return
    await fetch(`${API}/monitors/${id}`, { method: 'DELETE' })
    loadData()
  }

  if (selectedMonitor) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <MonitorDetail monitor={selectedMonitor} onBack={() => { setSelectedMonitor(null); loadData() }} />
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
          <div className="flex gap-2">
            <button onClick={() => setShowSettings(true)} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50" title="设置">⚙️</button>
            <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm">
              + 添加监控
            </button>
          </div>
        </div>

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
            <p className="text-sm text-gray-400 mt-1">点击「添加监控」开始盯着你关心的网页</p>
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
      <AddMonitorDialog open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => loadData()} />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
