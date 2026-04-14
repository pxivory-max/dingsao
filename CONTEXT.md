# 盯梢 (DingSao) — AI 信息雷达

## 产品定位
面向中国小团队/个人的轻量级 AI 信息监控工具。
用户添加要监控的网页 URL，系统定时抓取、AI 对比变化、自动推送通知。

## 技术栈
- **后端**: Node.js + Express + SQLite (better-sqlite3)
- **前端**: React + Vite + Tailwind CSS v4
- **AI**: 火山方舟 API (OpenAI 兼容格式, doubao-seed-2.0-pro)
- **抓取**: node-fetch + cheerio (轻量 HTML 解析)
- **定时**: node-cron
- **部署**: 单端口前后端一体化 + Cloudflare Tunnel

## 环境变量 (.env)
```
PORT=18800
ARK_API_KEY=<从 projects/clawgig-agent/.env 复制>
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-2.0-pro
```

## MVP 功能
1. **监控管理** — CRUD 监控任务（URL + 名称 + 检查频率）
2. **定时抓取** — 根据频率抓取网页，提取正文文本
3. **AI 变化检测** — 对比新旧内容，AI 总结变化要点
4. **通知推送** — 有变化时发送通知（MVP 先做飞书 Webhook）
5. **Web 界面** — 管理监控任务 + 查看变化历史

## API 设计
```
POST   /api/monitors          — 创建监控
GET    /api/monitors          — 列出所有监控
PUT    /api/monitors/:id      — 更新监控
DELETE /api/monitors/:id      — 删除监控
POST   /api/monitors/:id/check — 手动触发检查
GET    /api/monitors/:id/changes — 查看变化历史
GET    /api/stats              — 概览统计
```

## 数据库 Schema
```sql
CREATE TABLE monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  selector TEXT,              -- CSS 选择器，只监控页面特定区域
  frequency INTEGER DEFAULT 60, -- 检查频率（分钟）
  last_content TEXT,
  last_check_at TEXT,
  status TEXT DEFAULT 'active', -- active / paused / error
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  old_content TEXT,
  new_content TEXT,
  ai_summary TEXT,            -- AI 生成的变化摘要
  detected_at TEXT DEFAULT (datetime('now')),
  notified INTEGER DEFAULT 0,
  FOREIGN KEY (monitor_id) REFERENCES monitors(id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## 注意事项
- Tailwind v4 用 `@import "tailwindcss"`，不是 v3 的 `@tailwind`
- 前端 build 到 `client/dist/`，Express 静态服务 + SPA fallback
- 所有 API 响应统一 JSON 格式: `{ success: true, data: ... }` 或 `{ success: false, error: ... }`
- 抓取时设置合理的 User-Agent 和超时(10s)
- AI 调用做好错误处理和降级（AI 挂了就返回 diff 原文）
