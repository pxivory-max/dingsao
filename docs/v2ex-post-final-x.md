# V2EX 发帖 - 盯梢 DingSao（待 X 最终审阅）

**标题：** 不想再手动刷网页了，写了个工具自动盯着页面变化，AI 总结变了什么

**节点：** /go/create

---

## 正文

工作中经常要反复刷一些网页看有没有更新——竞品改了定价、目标公司发了新岗位、行业论坛出了新帖、政府发了新政策。

手动刷太蠢了，试过 changedetection.io，但要自己搭 Docker，而且只告诉你"页面变了"——得自己去看变了哪儿。

所以我写了「**盯梢**」，一个在线的网页变化监控工具。填个网址就行，定时帮你抓取，有变化时**用 AI 总结具体变了什么**，然后推送到飞书。

### 界面长这样

![盯梢主界面](https://raw.githubusercontent.com/pxivory-max/dingsao/master/docs/screenshot-1-dashboard.png)

### AI 摘要效果

比如我监控 Hacker News 首页，AI 摘要长这样：

![AI 摘要示例](https://raw.githubusercontent.com/pxivory-max/dingsao/master/docs/hn-detail.png)

摘要会告诉你：
- 哪些帖子排名变了
- 点赞数/评论数变化
- 新增了什么内容
- 哪些内容消失了

中文页面也没问题，比如监控 36Kr：

> **新增内容：**
> - 36氪首发｜推出消费级水下机器人，「深之蓝」完成C+轮1.5亿元融资
> - 电商红利消退，谁在为「品牌出海」提供服务？
> - 新物种爆发，开卷2019 ·上篇
>
> **排序变化：**
> - "快看世界" 从第5位下降到第8位
> - "初创公司" 从第6位上升到第5位

比纯文本 diff 有用太多了。而且中文支持本身就比 changedetection.io 好不少——界面、通知、AI 摘要全中文。

### 飞书推送配置

配个 Webhook 就行，有变化自动推送：

![飞书 Webhook 配置](https://raw.githubusercontent.com/pxivory-max/dingsao/master/docs/screenshot-3-feishu-settings.png)

（微信和邮箱推送在做了，最近会上）

### 简单说下技术

Node.js + React + SQLite，AI 摘要用的火山方舟的模型。支持 CSS 选择器只监控页面特定区域，抓取频率从 15 分钟到每天可选。

目前部署在个人服务器上，通过 Cloudflare Tunnel 暴露。还在 MVP 阶段，暂时不需要注册，打开就能用。数据存在服务端 SQLite 里。后面会上正式域名和账号系统。

### 体验地址

https://affiliation-reply-bishop-developing.trycloudflare.com

你可以直接试：找个你平时会反复刷的网页（比如某个论坛、某个招聘页），填进去选 15 分钟检查一次，过一会儿回来看看摘要效果。

---

有什么想监控的场景可以在回帖聊聊，我看看这工具还缺什么。如果遇到抓取有问题的网页也告诉我，我来调 👀

---

## 修改要点（相对审阅报告）

✅ **已修改：**
1. 删掉"大家好，分享一个我做的小工具"废话开头
2. 痛点+方案融合成故事流，不分「痛点」「功能」两节
3. 补充 3 张截图（主界面、AI 摘要、飞书配置），使用 GitHub raw 链接
4. AI 模型从 "Claude Sonnet" 改为 "火山方舟"
5. 补充中文优势（界面、通知、AI 摘要全中文）
6. 技术栈融入正文一句话带过
7. 规划功能从 5 条砍到 1 句（只提微信/邮箱在做）
8. 标题缩短 + 痛点前置
9. 补充体验引导："找个你常刷的网页填进去"
10. 结尾从"欢迎反馈"改为"聊聊你想监控什么场景"
11. 坦诚说明 MVP 阶段/trycloudflare
12. 补中文网页的 AI 摘要示例（36Kr 文字示例）

✅ **已确认：**
- CF Tunnel 可访问：https://affiliation-reply-bishop-developing.trycloudflare.com
- 截图已推送到 GitHub，公开可访问
- V2EX 节点确认为 /go/create（不是 /go/promotions）

**请 X 审阅通过后，我将立即发布到 V2EX。**
