# Show HN: DingSao – AI-powered web monitoring that tells you *what* changed, not just *when*

**Live Demo:** https://martha-terminal-shows-opinions.trycloudflare.com  
**GitHub:** https://github.com/pxivory-max/dingsao

I built DingSao (盯梢, Chinese for "tailing/surveillance") to solve a personal frustration: constantly checking HN, Product Hunt, GitHub Trending, and competitor sites for updates.

Existing web monitoring tools (Visualping, ChangeTower) tell you *when* pages change, but dump raw HTML diffs on you. DingSao uses AI (any OpenAI-compatible API) to generate structured summaries: what was added, what was removed, what rankings changed, which numbers went up/down.

**Key features:**
- 🤖 **AI summaries**: Instead of "127,423 characters changed", you get "Claude Code rose from #4 to #2 (515 points, 302 comments)" 
- 🌐 **JS rendering**: Uses Playwright for SPAs and dynamic sites (e-commerce, React apps)
- 🎯 **CSS selectors**: Monitor only specific page sections (pricing tables, changelog sections)
- 🔔 **Multi-channel push**: Webhooks (Slack, Feishu, Discord), email, or API polling
- 🔑 **Keyword filters**: Get notified only when changes contain terms you care about

**Tech stack:** Node.js + Express + SQLite + React + Vite + Playwright

**Use cases I'm using it for:**
- Tracking this HN front page (sees ranking shifts every ~30 min)
- Monitoring Next.js/Tailwind release pages for new versions
- Watching competitor pricing pages
- Catching new job posts on company career pages before they hit LinkedIn

The AI summaries are ~70% accurate in my testing — great for numerical data, sometimes confuses "ranking drop" with "disappeared". Still way better than manual diffing.

**Try it:** Add any URL to the demo site, come back in 15 minutes, see the AI summary. Self-hosting takes 5 minutes if you have Node.js + an OpenAI API key.

Open-source (MIT). Built this as a solo side project. Feedback and PRs welcome!
