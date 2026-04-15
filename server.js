require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');
const nodemailer = require('nodemailer');

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

// --- Schema Migrations ---
try { db.exec(`ALTER TABLE monitors ADD COLUMN keywords TEXT`); } catch(e) { /* column already exists */ }
try { db.exec(`ALTER TABLE changes ADD COLUMN filtered INTEGER DEFAULT 0`); } catch(e) { /* column already exists */ }

// --- Helpers ---
const ok = (data) => ({ success: true, data });
const fail = (error) => ({ success: false, error });

// Lightweight HTTP fetch
async function fetchPageLight(url, selector) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, noscript, iframe').remove();
    let text;
    if (selector) {
      text = $(selector).text();
      if (!text.trim()) text = $('body').text();
    } else {
      text = $('body').text();
    }
    return text.replace(/\s+/g, ' ').trim().substring(0, 50000);
  } finally {
    clearTimeout(timeout);
  }
}

// Playwright browser fetch for JS-rendered pages
let _browser = null;
async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    const { chromium } = require('playwright');
    _browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  return _browser;
}

async function fetchPageBrowser(url, selector) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'zh-CN'
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // Wait for JS rendering
    let text;
    if (selector) {
      text = await page.textContent(selector).catch(() => null);
    }
    if (!text) {
      text = await page.evaluate(() => {
        ['script','style','nav','footer','header','noscript','iframe'].forEach(tag => {
          document.querySelectorAll(tag).forEach(el => el.remove());
        });
        return document.body?.innerText || '';
      });
    }
    return (text || '').replace(/\s+/g, ' ').trim().substring(0, 50000);
  } finally {
    await context.close();
  }
}

// Smart fetch: try light first, fallback to browser if content too short
const MIN_CONTENT_LENGTH = 100;
async function fetchPage(url, selector) {
  try {
    const text = await fetchPageLight(url, selector);
    if (text.length >= MIN_CONTENT_LENGTH) return text;
    console.log(`[轻量抓取内容过短 (${text.length}字符)，切换浏览器渲染: ${url}]`);
  } catch(e) {
    console.log(`[轻量抓取失败 (${e.message})，切换浏览器渲染: ${url}]`);
  }
  try {
    return await fetchPageBrowser(url, selector);
  } catch(e) {
    throw new Error(`抓取失败(HTTP+浏览器均失败): ${e.message}`);
  }
}

async function aiSummarize(oldContent, newContent) {
  if (!process.env.AI_API_KEY || !process.env.AI_ENDPOINT) {
    return diffFallback(oldContent, newContent);
  }
  try {
    const res = await fetch(process.env.AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'MaaS_Sonnet_4',
        messages: [
          {
            role: 'system',
            content: '你是一个网页变化分析助手。精确对比旧内容和新内容的差异。\n\n规则：\n1. 严格基于给定文本对比，不推测截取范围外的内容\n2. 区分"消失"和"移出视野"：旧内容有但新内容没有的条目，说"在当前视野中未出现"而非"被删除"（可能只是排名移出了截取范围）\n3. 新出现的条目明确标注\n4. 数字变化精确标注（如 486→501）\n5. 能看出顺序变化的标注位移\n6. 仅排版/空格/时间戳变化→说"无实质性变化"\n\n输出格式（没有的跳过）：\n🆕 新出现 | 📊 数据/排名变化 | 👋 视野中未出现 | 📝 其他修改\n不超过300字。'
          },
          {
            role: 'user',
            content: `旧内容（前3000字）：\n${oldContent.substring(0, 3000)}\n\n新内容（前3000字）：\n${newContent.substring(0, 3000)}`
          }
        ],
        temperature: 0.2,
        max_tokens: 800
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
  if (a === b) return false;
  // Compare first 5000 chars for actual text difference
  const sample = Math.min(5000, a.length, b.length);
  let diffChars = 0;
  for (let i = 0; i < sample; i++) {
    if (a[i] !== b[i]) diffChars++;
  }
  const diffRatio = diffChars / sample;
  // If less than 0.5% of characters differ, treat as no change (noise)
  if (diffRatio < 0.005) return false;
  return true;
}

// --- Notification Helpers ---
function getSetting(key) {
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value || '';
}

async function sendFeishuNotification(monitor, summary) {
  const webhookUrl = getSetting('feishu_webhook');
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[通知] 已发送飞书通知: ${monitor.name}`);
  } catch (e) {
    console.error(`[通知] 飞书发送失败:`, e.message);
  }
}

async function sendWebhookNotification(monitor, summary) {
  const webhookUrl = getSetting('webhook_url');
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monitor_name: monitor.name,
        monitor_url: monitor.url,
        summary: summary,
        detected_at: new Date().toISOString()
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[通知] 已发送 Webhook 通知: ${monitor.name}`);
  } catch (e) {
    console.error(`[通知] Webhook 发送失败:`, e.message);
  }
}

async function sendEmailNotification(monitor, summary) {
  const emailTo = getSetting('email_to');
  const smtpHost = getSetting('smtp_host');
  const smtpPort = getSetting('smtp_port') || '587';
  const smtpUser = getSetting('smtp_user');
  const smtpPass = getSetting('smtp_pass');
  if (!emailTo || !smtpHost || !smtpUser || !smtpPass) return;
  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: parseInt(smtpPort) === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });
    await transporter.sendMail({
      from: smtpUser,
      to: emailTo,
      subject: `🔭 盯梢提醒：${monitor.name} 发生变化`,
      html: `<h2>🚨 ${monitor.name} 发生变化</h2>
<p><strong>网址：</strong><a href="${monitor.url}">${monitor.url}</a></p>
<h3>AI 摘要</h3>
<p>${summary.replace(/\n/g, '<br>')}</p>
<hr>
<p style="color:#999;font-size:12px">来自盯梢（DingSao）监控系统</p>`
    });
    console.log(`[通知] 已发送邮件通知: ${monitor.name} → ${emailTo}`);
  } catch (e) {
    console.error(`[通知] 邮件发送失败:`, e.message);
  }
}

async function sendNotification(monitor, summary) {
  const results = await Promise.allSettled([
    sendFeishuNotification(monitor, summary),
    sendWebhookNotification(monitor, summary),
    sendEmailNotification(monitor, summary)
  ]);
  // Mark changes as notified if any notification was attempted
  const anyConfigured = getSetting('feishu_webhook') || getSetting('webhook_url') || getSetting('email_to');
  if (anyConfigured) {
    db.prepare(`UPDATE changes SET notified = 1 WHERE monitor_id = ? AND notified = 0`).run(monitor.id);
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

    // Keyword filtering
    let filtered = 0;
    if (monitor.keywords && monitor.keywords.trim()) {
      const kws = monitor.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      if (kws.length > 0) {
        const haystack = (summary + ' ' + newContent).toLowerCase();
        const matched = kws.some(kw => haystack.includes(kw));
        if (!matched) filtered = 1;
      }
    }

    // Save change
    db.prepare('INSERT INTO changes (monitor_id, old_content, new_content, ai_summary, filtered) VALUES (?, ?, ?, ?, ?)').run(
      monitor.id, monitor.last_content.substring(0, 10000), newContent.substring(0, 10000), summary, filtered
    );
    updateStmt.run('active', null, newContent, monitor.id);
    if (filtered) {
      console.log(`[${monitor.name}] 检测到变化但未匹配关键词，已过滤: ${summary.substring(0, 80)}`);
    } else {
      console.log(`[${monitor.name}] 检测到变化: ${summary.substring(0, 100)}`);
      // Send notification (only for non-filtered changes)
      await sendNotification(monitor, summary);
    }
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
  const { name, url, selector, frequency, keywords } = req.body;
  if (!name || !url) return res.status(400).json(fail('name 和 url 必填'));
  try {
    new URL(url); // validate URL
  } catch {
    return res.status(400).json(fail('无效的 URL'));
  }
  const result = db.prepare('INSERT INTO monitors (name, url, selector, frequency, keywords) VALUES (?, ?, ?, ?, ?)').run(
    name, url, selector || null, frequency || 60, keywords || null
  );
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(result.lastInsertRowid);
  // Trigger first check immediately
  checkMonitor(monitor).catch(e => console.error('First check error:', e.message));
  res.json(ok(monitor));
});

// List monitors
app.get('/api/monitors', (req, res) => {
  const monitors = db.prepare('SELECT id, name, url, selector, frequency, keywords, last_check_at, status, error_message, created_at, updated_at FROM monitors ORDER BY created_at DESC').all();
  res.json(ok(monitors));
});

// Update monitor
app.put('/api/monitors/:id', (req, res) => {
  const { name, url, selector, frequency, status, keywords } = req.body;
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  db.prepare(`UPDATE monitors SET name = ?, url = ?, selector = ?, frequency = ?, status = ?, keywords = ?, updated_at = datetime('now') WHERE id = ?`).run(
    name || monitor.name, url || monitor.url, selector !== undefined ? selector : monitor.selector,
    frequency || monitor.frequency, status || monitor.status, keywords !== undefined ? keywords : monitor.keywords, req.params.id
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
  const showAll = req.query.all === '1';
  const changes = showAll
    ? db.prepare('SELECT id, monitor_id, ai_summary, detected_at, notified, filtered FROM changes WHERE monitor_id = ? ORDER BY detected_at DESC LIMIT ?').all(req.params.id, limit)
    : db.prepare('SELECT id, monitor_id, ai_summary, detected_at, notified, filtered FROM changes WHERE monitor_id = ? AND filtered = 0 ORDER BY detected_at DESC LIMIT ?').all(req.params.id, limit);
  const totalChanges = db.prepare('SELECT COUNT(*) as count FROM changes WHERE monitor_id = ?').get(req.params.id).count;
  const filteredChanges = db.prepare('SELECT COUNT(*) as count FROM changes WHERE monitor_id = ? AND filtered = 1').get(req.params.id).count;
  res.json(ok({ monitor: { id: monitor.id, name: monitor.name, url: monitor.url }, changes, totalChanges, filteredChanges }));
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

// Batch settings update
app.post('/api/settings/batch', (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json(fail('settings 对象必填'));
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const saveMany = db.transaction((items) => {
    for (const [key, value] of Object.entries(items)) {
      upsert.run(key, value || '');
    }
  });
  saveMany(settings);
  res.json(ok(settings));
});

// Test notification endpoint
app.post('/api/settings/test-notification', async (req, res) => {
  const { type } = req.body; // 'feishu' | 'webhook' | 'email'
  const testMonitor = { id: 0, name: '测试监控', url: 'https://example.com' };
  const testSummary = '🧪 这是一条测试通知，说明你的通知配置正确！';
  try {
    if (type === 'feishu') {
      const url = getSetting('feishu_webhook');
      if (!url) return res.status(400).json(fail('请先配置飞书 Webhook URL'));
      await sendFeishuNotification(testMonitor, testSummary);
    } else if (type === 'webhook') {
      const url = getSetting('webhook_url');
      if (!url) return res.status(400).json(fail('请先配置 Webhook URL'));
      await sendWebhookNotification(testMonitor, testSummary);
    } else if (type === 'email') {
      const emailTo = getSetting('email_to');
      if (!emailTo) return res.status(400).json(fail('请先配置收件邮箱'));
      await sendEmailNotification(testMonitor, testSummary);
    } else {
      return res.status(400).json(fail('type 必须是 feishu/webhook/email'));
    }
    res.json(ok({ sent: true }));
  } catch (e) {
    res.status(500).json(fail(`发送失败: ${e.message}`));
  }
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
