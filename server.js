require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- Database ---
const db = new Database(path.join(__dirname, 'dingsao.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    selector TEXT,
    frequency INTEGER DEFAULT 60,
    last_content TEXT,
    last_check_at TEXT,
    status TEXT DEFAULT 'active',
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL,
    old_content TEXT,
    new_content TEXT,
    ai_summary TEXT,
    detected_at TEXT DEFAULT (datetime('now')),
    notified INTEGER DEFAULT 0,
    FOREIGN KEY (monitor_id) REFERENCES monitors(id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// --- Helpers ---
const ok = (data) => ({ success: true, data });
const fail = (error) => ({ success: false, error });

async function fetchPage(url, selector) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DingSao/1.0; +https://dingsao.ai)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, noscript, iframe').remove();
    let text;
    if (selector) {
      text = $(selector).text();
      if (!text.trim()) text = $('body').text(); // fallback
    } else {
      text = $('body').text();
    }
    // Normalize whitespace
    return text.replace(/\s+/g, ' ').trim().substring(0, 50000);
  } finally {
    clearTimeout(timeout);
  }
}

async function aiSummarize(oldContent, newContent) {
  if (!process.env.ARK_API_KEY || !process.env.ARK_ENDPOINT) {
    return diffFallback(oldContent, newContent);
  }
  try {
    const res = await fetch(process.env.ARK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ARK_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.ARK_MODEL || 'doubao-seed-2.0-pro',
        messages: [
          {
            role: 'system',
            content: '你是一个信息变化分析助手。用户会给你一个网页的旧内容和新内容，请用简洁的中文总结发生了什么变化。重点关注：新增内容、删除内容、修改内容。如果变化很小（只是排版/空格变化），说"无实质性变化"。输出不超过 200 字。'
          },
          {
            role: 'user',
            content: `旧内容（前2000字）：\n${oldContent.substring(0, 2000)}\n\n新内容（前2000字）：\n${newContent.substring(0, 2000)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });
    if (!res.ok) throw new Error(`AI API ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || diffFallback(oldContent, newContent);
  } catch (e) {
    console.error('AI summarize error:', e.message);
    return diffFallback(oldContent, newContent);
  }
}

function diffFallback(oldContent, newContent) {
  const oldLen = oldContent.length;
  const newLen = newContent.length;
  const diff = newLen - oldLen;
  return `内容长度变化: ${oldLen} → ${newLen} (${diff > 0 ? '+' : ''}${diff} 字符)。AI 摘要暂不可用，请查看原文对比。`;
}

function contentChanged(oldContent, newContent) {
  if (!oldContent) return true;
  // Normalize and compare
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  const a = normalize(oldContent);
  const b = normalize(newContent);
  // Allow 0.5% tolerance for minor whitespace/ad changes
  if (a === b) return false;
  const similarity = 1 - (Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1));
  if (similarity > 0.995) return false;
  return true;
}

async function sendNotification(monitor, summary) {
  // Feishu webhook notification
  const webhookUrl = db.prepare(`SELECT value FROM settings WHERE key = 'feishu_webhook'`).get()?.value;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: `🚨 ${monitor.name} 发生变化` },
            template: 'orange'
          },
          elements: [
            { tag: 'markdown', content: `**监控对象：** ${monitor.name}\n**网址：** ${monitor.url}\n\n**AI 摘要：**\n${summary}` },
            { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看网页' }, url: monitor.url, type: 'primary' }] }
          ]
        }
      })
    });
    // Mark change as notified
    db.prepare(`UPDATE changes SET notified = 1 WHERE monitor_id = ? AND notified = 0`).run(monitor.id);
    console.log(`[通知] 已发送飞书通知: ${monitor.name}`);
  } catch (e) {
    console.error(`[通知] 飞书发送失败:`, e.message);
  }
}

async function checkMonitor(monitor) {
  const updateStmt = db.prepare(`UPDATE monitors SET last_check_at = datetime('now'), updated_at = datetime('now'), status = ?, error_message = ?, last_content = ? WHERE id = ?`);
  try {
    const newContent = await fetchPage(monitor.url, monitor.selector);
    if (!newContent || newContent.length < 10) {
      updateStmt.run('error', '抓取内容为空或太短', monitor.last_content, monitor.id);
      return;
    }
    if (!monitor.last_content) {
      // First check, save baseline
      updateStmt.run('active', null, newContent, monitor.id);
      console.log(`[${monitor.name}] 首次抓取完成，已保存基线内容 (${newContent.length} 字符)`);
      return;
    }
    if (!contentChanged(monitor.last_content, newContent)) {
      updateStmt.run('active', null, monitor.last_content, monitor.id);
      return;
    }
    // Content changed! AI summarize
    const summary = await aiSummarize(monitor.last_content, newContent);
    // Save change
    db.prepare('INSERT INTO changes (monitor_id, old_content, new_content, ai_summary) VALUES (?, ?, ?, ?)').run(
      monitor.id, monitor.last_content.substring(0, 10000), newContent.substring(0, 10000), summary
    );
    updateStmt.run('active', null, newContent, monitor.id);
    console.log(`[${monitor.name}] 检测到变化: ${summary.substring(0, 100)}`);
    // Send notification
    await sendNotification(monitor, summary);
  } catch (e) {
    updateStmt.run('error', e.message, monitor.last_content, monitor.id);
    console.error(`[${monitor.name}] 抓取失败:`, e.message);
  }
}

// --- Scheduler ---
const checkSchedule = () => {
  const monitors = db.prepare('SELECT * FROM monitors WHERE status = ?').all('active');
  const now = Date.now();
  for (const m of monitors) {
    const lastCheck = m.last_check_at ? new Date(m.last_check_at + 'Z').getTime() : 0;
    const interval = (m.frequency || 60) * 60 * 1000;
    if (now - lastCheck >= interval) {
      checkMonitor(m).catch(e => console.error(`Schedule check error for [${m.name}]:`, e.message));
    }
  }
};

// Run scheduler every minute
cron.schedule('* * * * *', checkSchedule);

// --- API Routes ---

// Create monitor
app.post('/api/monitors', (req, res) => {
  const { name, url, selector, frequency } = req.body;
  if (!name || !url) return res.status(400).json(fail('name 和 url 必填'));
  try {
    new URL(url); // validate URL
  } catch {
    return res.status(400).json(fail('无效的 URL'));
  }
  const result = db.prepare('INSERT INTO monitors (name, url, selector, frequency) VALUES (?, ?, ?, ?)').run(
    name, url, selector || null, frequency || 60
  );
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(result.lastInsertRowid);
  // Trigger first check immediately
  checkMonitor(monitor).catch(e => console.error('First check error:', e.message));
  res.json(ok(monitor));
});

// List monitors
app.get('/api/monitors', (req, res) => {
  const monitors = db.prepare('SELECT id, name, url, selector, frequency, last_check_at, status, error_message, created_at, updated_at FROM monitors ORDER BY created_at DESC').all();
  res.json(ok(monitors));
});

// Update monitor
app.put('/api/monitors/:id', (req, res) => {
  const { name, url, selector, frequency, status } = req.body;
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  db.prepare(`UPDATE monitors SET name = ?, url = ?, selector = ?, frequency = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    name || monitor.name, url || monitor.url, selector !== undefined ? selector : monitor.selector,
    frequency || monitor.frequency, status || monitor.status, req.params.id
  );
  res.json(ok(db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id)));
});

// Delete monitor
app.delete('/api/monitors/:id', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  db.prepare('DELETE FROM changes WHERE monitor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
  res.json(ok({ deleted: true }));
});

// Manual check
app.post('/api/monitors/:id/check', async (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  try {
    await checkMonitor(monitor);
    const updated = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
    res.json(ok(updated));
  } catch (e) {
    res.status(500).json(fail(e.message));
  }
});

// Get changes for a monitor
app.get('/api/monitors/:id/changes', (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  const limit = parseInt(req.query.limit) || 50;
  const changes = db.prepare('SELECT id, monitor_id, ai_summary, detected_at, notified FROM changes WHERE monitor_id = ? ORDER BY detected_at DESC LIMIT ?').all(req.params.id, limit);
  res.json(ok({ monitor: { id: monitor.id, name: monitor.name, url: monitor.url }, changes }));
});

// Get single change detail
app.get('/api/changes/:id', (req, res) => {
  const change = db.prepare('SELECT * FROM changes WHERE id = ?').get(req.params.id);
  if (!change) return res.status(404).json(fail('变化记录不存在'));
  res.json(ok(change));
});

// Settings
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(ok(settings));
});

app.put('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json(fail('key 必填'));
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value || '');
  res.json(ok({ [key]: value }));
});

// Stats
app.get('/api/stats', (req, res) => {
  const totalMonitors = db.prepare('SELECT COUNT(*) as count FROM monitors').get().count;
  const activeMonitors = db.prepare('SELECT COUNT(*) as count FROM monitors WHERE status = ?').get('active').count;
  const totalChanges = db.prepare('SELECT COUNT(*) as count FROM changes').get().count;
  const recentChanges = db.prepare(`SELECT COUNT(*) as count FROM changes WHERE detected_at > datetime('now', '-24 hours')`).get().count;
  res.json(ok({ totalMonitors, activeMonitors, totalChanges, recentChanges }));
});

// --- Static files (SPA) ---
const clientDist = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));
app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json(fail('API not found'));
  res.sendFile(path.join(clientDist, 'index.html'));
});

// --- Start ---
const PORT = process.env.PORT || 18800;
app.listen(PORT, () => {
  console.log(`🔭 盯梢 (DingSao) 运行中: http://localhost:${PORT}`);
  console.log(`📊 监控数: ${db.prepare('SELECT COUNT(*) as count FROM monitors').get().count}`);
  // Run initial check
  setTimeout(checkSchedule, 5000);
});
