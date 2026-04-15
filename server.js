require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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

// --- Users table ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// --- Schema Migrations ---
try { db.exec(`ALTER TABLE monitors ADD COLUMN keywords TEXT`); } catch(e) { /* column already exists */ }
try { db.exec(`ALTER TABLE changes ADD COLUMN filtered INTEGER DEFAULT 0`); } catch(e) { /* column already exists */ }
try { db.exec(`ALTER TABLE monitors ADD COLUMN user_id INTEGER DEFAULT NULL`); } catch(e) { /* column already exists */ }
try { db.exec(`ALTER TABLE settings ADD COLUMN user_id INTEGER DEFAULT NULL`); } catch(e) { /* column already exists */ }

// --- JWT & Auth Helpers ---
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json(fail('未登录'));
  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.status(401).json(fail('登录已过期，请重新登录'));
  req.user = payload;
  next();
}

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
function getSetting(key, userId) {
  if (userId) {
    return db.prepare(`SELECT value FROM settings WHERE key = ? AND user_id = ?`).get(key, userId)?.value || '';
  }
  return db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value || '';
}

async function sendFeishuNotification(monitor, summary) {
  const webhookUrl = getSetting('feishu_webhook', monitor.user_id);
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
  const webhookUrl = getSetting('webhook_url', monitor.user_id);
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
  const emailTo = getSetting('email_to', monitor.user_id);
  const smtpHost = getSetting('smtp_host', monitor.user_id);
  const smtpPort = getSetting('smtp_port', monitor.user_id) || '587';
  const smtpUser = getSetting('smtp_user', monitor.user_id);
  const smtpPass = getSetting('smtp_pass', monitor.user_id);
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
  const anyConfigured = getSetting('feishu_webhook', monitor.user_id) || getSetting('webhook_url', monitor.user_id) || getSetting('email_to', monitor.user_id);
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

// --- Auth API Routes ---

app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json(fail('email、password、name 必填'));
  if (password.length < 6) return res.status(400).json(fail('密码至少 6 位'));
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json(fail('该邮箱已注册'));
  const password_hash = hashPassword(password);
  const result = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, password_hash, name);
  const userId = result.lastInsertRowid;
  // First user inherits existing monitors and settings that have no user_id
  db.prepare('UPDATE monitors SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE settings SET user_id = ? WHERE user_id IS NULL').run(userId);
  const token = createToken({ id: userId, email, name });
  res.json(ok({ token, user: { id: userId, email, name } }));
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json(fail('email 和 password 必填'));
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json(fail('邮箱或密码错误'));
  try {
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json(fail('邮箱或密码错误'));
  } catch {
    return res.status(401).json(fail('邮箱或密码错误'));
  }
  const token = createToken({ id: user.id, email: user.email, name: user.name });
  res.json(ok({ token, user: { id: user.id, email: user.email, name: user.name } }));
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json(fail('用户不存在'));
  res.json(ok(user));
});

// --- API Routes (protected) ---

// Create monitor
app.post('/api/monitors', authMiddleware, (req, res) => {
  const { name, url, selector, frequency, keywords } = req.body;
  if (!name || !url) return res.status(400).json(fail('name 和 url 必填'));
  try {
    new URL(url); // validate URL
  } catch {
    return res.status(400).json(fail('无效的 URL'));
  }
  const result = db.prepare('INSERT INTO monitors (name, url, selector, frequency, keywords, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    name, url, selector || null, frequency || 60, keywords || null, req.user.id
  );
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(result.lastInsertRowid);
  // Trigger first check immediately
  checkMonitor(monitor).catch(e => console.error('First check error:', e.message));
  res.json(ok(monitor));
});

// List monitors (scoped to user)
app.get('/api/monitors', authMiddleware, (req, res) => {
  const monitors = db.prepare('SELECT id, name, url, selector, frequency, keywords, last_check_at, status, error_message, created_at, updated_at FROM monitors WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(ok(monitors));
});

// Update monitor (scoped to user)
app.put('/api/monitors/:id', authMiddleware, (req, res) => {
  const { name, url, selector, frequency, status, keywords } = req.body;
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  db.prepare(`UPDATE monitors SET name = ?, url = ?, selector = ?, frequency = ?, status = ?, keywords = ?, updated_at = datetime('now') WHERE id = ?`).run(
    name || monitor.name, url || monitor.url, selector !== undefined ? selector : monitor.selector,
    frequency || monitor.frequency, status || monitor.status, keywords !== undefined ? keywords : monitor.keywords, req.params.id
  );
  res.json(ok(db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id)));
});

// Delete monitor (scoped to user)
app.delete('/api/monitors/:id', authMiddleware, (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  db.prepare('DELETE FROM changes WHERE monitor_id = ?').run(req.params.id);
  db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
  res.json(ok({ deleted: true }));
});

// Manual check (scoped to user)
app.post('/api/monitors/:id/check', authMiddleware, async (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!monitor) return res.status(404).json(fail('监控不存在'));
  try {
    await checkMonitor(monitor);
    const updated = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
    res.json(ok(updated));
  } catch (e) {
    res.status(500).json(fail(e.message));
  }
});

// Get changes for a monitor (scoped to user)
app.get('/api/monitors/:id/changes', authMiddleware, (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
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

// Get single change detail (scoped to user via monitor)
app.get('/api/changes/:id', authMiddleware, (req, res) => {
  const change = db.prepare('SELECT c.* FROM changes c JOIN monitors m ON c.monitor_id = m.id WHERE c.id = ? AND m.user_id = ?').get(req.params.id, req.user.id);
  if (!change) return res.status(404).json(fail('变化记录不存在'));
  res.json(ok(change));
});

// Settings (scoped to user)
app.get('/api/settings', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings WHERE user_id = ?').all(req.user.id);
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(ok(settings));
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json(fail('key 必填'));
  // Use composite unique: delete old then insert
  db.prepare('DELETE FROM settings WHERE key = ? AND user_id = ?').run(key, req.user.id);
  db.prepare('INSERT INTO settings (key, value, user_id) VALUES (?, ?, ?)').run(key, value || '', req.user.id);
  res.json(ok({ [key]: value }));
});

// Batch settings update (scoped to user)
app.post('/api/settings/batch', authMiddleware, (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json(fail('settings 对象必填'));
  const del = db.prepare('DELETE FROM settings WHERE key = ? AND user_id = ?');
  const ins = db.prepare('INSERT INTO settings (key, value, user_id) VALUES (?, ?, ?)');
  const saveMany = db.transaction((items) => {
    for (const [key, value] of Object.entries(items)) {
      del.run(key, req.user.id);
      ins.run(key, value || '', req.user.id);
    }
  });
  saveMany(settings);
  res.json(ok(settings));
});

// Test notification endpoint
app.post('/api/settings/test-notification', authMiddleware, async (req, res) => {
  const { type } = req.body; // 'feishu' | 'webhook' | 'email'
  const testMonitor = { id: 0, name: '测试监控', url: 'https://example.com', user_id: req.user.id };
  const testSummary = '🧪 这是一条测试通知，说明你的通知配置正确！';
  try {
    if (type === 'feishu') {
      const url = getSetting('feishu_webhook', req.user.id);
      if (!url) return res.status(400).json(fail('请先配置飞书 Webhook URL'));
      await sendFeishuNotification(testMonitor, testSummary);
    } else if (type === 'webhook') {
      const url = getSetting('webhook_url', req.user.id);
      if (!url) return res.status(400).json(fail('请先配置 Webhook URL'));
      await sendWebhookNotification(testMonitor, testSummary);
    } else if (type === 'email') {
      const emailTo = getSetting('email_to', req.user.id);
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

// Visit tracking (lightweight)
try { db.exec(`CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, path TEXT, ua TEXT, ts TEXT DEFAULT (datetime('now')))`); } catch(e) {}
app.post('/api/track', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.ip;
  const { path: p } = req.body;
  try { db.prepare('INSERT INTO visits (ip, path, ua) VALUES (?, ?, ?)').run(ip || '', p || '/', (req.headers['user-agent'] || '').substring(0, 200)); } catch(e) {}
  res.json(ok({ tracked: true }));
});
app.get('/api/visits/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM visits').get().c;
  const today = db.prepare(`SELECT COUNT(*) as c FROM visits WHERE ts > datetime('now', '-24 hours')`).get().c;
  const uniqueIPs = db.prepare('SELECT COUNT(DISTINCT ip) as c FROM visits').get().c;
  const todayIPs = db.prepare(`SELECT COUNT(DISTINCT ip) as c FROM visits WHERE ts > datetime('now', '-24 hours')`).get().c;
  res.json(ok({ total, today, uniqueIPs, todayIPs }));
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
