# V2EX 发帖草稿 — 盯梢产品介绍

> 待 X 审核后发布到 V2EX /create 板块

---

**标题：** 做了一个 AI 网页监控工具「盯梢」，帮你盯着网页变化并用 AI 总结变了什么

**正文：**

大家好，分享一个我做的小工具。

## 痛点

工作中经常需要关注某些网页的变化：
- 竞品官网改了定价/功能
- 目标公司发了新岗位
- 行业论坛有了新帖子
- 政府网站发了新政策

手动刷太累，现有工具（changedetection.io 等）需要自己搭服务器，而且只告诉你"变了"，不告诉你"变了什么"。

## 盯梢是什么

一个在线的网页变化监控工具，核心功能：
1. **填入网址** — 支持 CSS 选择器精确监控页面特定区域
2. **定时抓取** — 15分钟到每天，自己选频率
3. **AI 智能摘要** — 不只告诉你变了，用 AI 总结具体变化内容
4. **飞书推送** — 配置 Webhook 后有变化自动发通知（微信/邮箱推送开发中）

## 举个例子

我拿 Hacker News 首页测试，AI 摘要是这样的：

> **排名调整：**
> - "A Communist Apple II" 从第9位上升到第7位
> - "Turn your best AI prompts into one-click tools" 从第7位下降到第8位
>
> **内容变化：**
> - 删除了第16条"Troubleshooting Email Delivery to Microsoft Users"
> - 新增了第16条"Free, fast diagnostic tools for DNS, email authentication, and network security"

比纯文本 diff 有用多了。

## 体验地址

https://himself-push-leone-gap.trycloudflare.com

免费体验，无需注册。

## 技术栈

Node.js + Express + SQLite + React + Tailwind
AI 摘要用的 Claude Sonnet
部署在个人服务器 + Cloudflare Tunnel

## 规划中的功能

- 微信/邮箱推送
- 用户账号系统
- 可视化 diff 对比
- 更多数据源（RSS、API 端点监控）
- 移动端适配

欢迎试用和反馈，有什么想监控的场景也欢迎说说 👀

---

**发布到：** V2EX - /create 或 /share
**标签建议：** 分享创造, AI, 工具
