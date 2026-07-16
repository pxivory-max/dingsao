const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  console.log('Navigating to MLH AI Hackfest...');
  try {
    await page.goto('https://events.mlh.io/events/13503-ai-hackfest', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);
    
    const title = await page.title();
    console.log('Page title:', title);
    
    const content = await page.evaluate(() => document.body.innerText.substring(0, 5000));
    console.log('Page content:', content);
    
    const buttons = await page.$$eval('a, button', els => 
      els.map(e => ({ text: e.textContent.trim(), href: e.href || '', tag: e.tagName }))
        .filter(e => /register|sign|join|apply|log\s*in/i.test(e.text))
    );
    console.log('Register buttons:', JSON.stringify(buttons, null, 2));
    
    await page.screenshot({ path: '/tmp/mlh-page.png', fullPage: true });
    console.log('Screenshot saved');
    
  } catch(e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: '/tmp/mlh-page.png' });
    console.log('Error screenshot saved');
  }
  
  await browser.close();
})();
