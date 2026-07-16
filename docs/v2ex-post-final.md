# V2EX 发帖最终版 - 盯梢 DingSao

**标题:** 不想再手动刷网页了,写了个工具自动盯着页面变化,AI 总结变了什么

**节点:** /go/create

---

## 正文

工作中经常要反复刷一些网页看有没有更新--竞品改了定价、目标公司发了新岗位、行业论坛出了新帖、政府发了新政策。

手动刷太蠢了,试过 changedetection.io,但要自己搭 Docker,而且只告诉你"页面变了"--得自己去看变了哪儿。

所以我写了「**盯梢**」,一个在线的网页变化监控工具。填个网址就行,定时帮你抓取,有变化时**用 AI 总结具体变了什么**,然后推送到飞书。

### 界面长这样

![盯梢主界面](docs/screenshot-1-dashboard.png)

### AI 摘要效果

比如我监控 Hacker News 首页,AI 摘要长这样:

> 📊 **数据/排名变化**
> - #1: 203→236 points, 45→57 comments
> - #2: 92→97 points, 41→44 comments
> - #3: 217→232 points, 132→134 comments, 9→10 hours ago
> - #4: 81→97 points, 32→40 comments
> - #7: 航空工人事件从47分钟→1小时前, 23→62 points, 8→37 comments, 排名从#8升至#7
> - #14: 🆕 Vercel安全事件新出现
> - #15: 日本铁路从#14降至#15, 454→459 points, 428→434 comments
>
> 👋 **在当前视野中未出现**
> - "Migrating from DigitalOcean to Hetzner"文章(旧内容#24,819 points)

中文支持本身就比 changedetection.io 好不少--界面、通知、AI 摘要全中文。这是监控 36Kr 的示例:

![中文监控示例](docs/monitor-detail-36kr.png)

比纯文本 diff 有用太多了。而且中文支持本身就比 changedetection.io 好不少--界面、通知、AI 摘要全中文。

### 飞书推送配置

配个 Webhook 就行，有变化自动推送：

![飞书设置](docs/screenshot-3-feishu-settings.png)

（实际推送效果图待补充。微信和邮箱推送在做了，最近会上）

### 简单说下技术

Node.js + React + SQLite,AI 摘要用的火山方舟的模型。支持 CSS 选择器只监控页面特定区域,抓取频率从 15 分钟到每天可选。

目前部署在个人服务器上,通过 Cloudflare Tunnel 暴露。还在 MVP 阶段,暂时不需要注册,打开就能用。数据存在服务端 SQLite 里。后面会上正式域名和账号系统。

### 体验地址

https://affiliation-reply-bishop-developing.trycloudflare.com

你可以直接试:找个你平时会反复刷的网页(比如某个论坛、某个招聘页),填进去选 15 分钟检查一次,过一会儿回来看看摘要效果。

---

有什么想监控的场景可以在回帖聊聊,我看看这工具还缺什么。如果遇到抓取有问题的网页也告诉我,我来调 👀

---

## 发布前 Checklist

- [ ] 截图已准备(main-interface.png / chinese-ai-summary.png / feishu-notification.png)
- [ ] 确认 CF Tunnel URL 可访问
- [ ] 实际测试中文网页 AI 摘要效果
- [ ] X 审阅通过
- [ ] 发布到 V2EX /go/create
