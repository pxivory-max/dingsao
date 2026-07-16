const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  console.log('Step 1: Go to sign in page...');
  try {
    await page.goto('https://events.mlh.io/sign_in', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    await page.waitForTimeout(2000);
    
    const title = await page.title();
    console.log('Page title:', title);
    
    const content = await page.evaluate(() => document.body.innerText.substring(0, 3000));
    console.log('Page content:', content);
    
    // Get all form fields
    const inputs = await page.$$eval('input, select, textarea', els => 
      els.map(e => ({ 
        type: e.type, 
        name: e.name, 
        id: e.id, 
        placeholder: e.placeholder,
        tag: e.tagName 
      }))
    );
    console.log('Form fields:', JSON.stringify(inputs, null, 2));
    
    // Get all links (especially OAuth)
    const links = await page.$$eval('a', els => 
      els.map(e => ({ text: e.textContent.trim(), href: e.href }))
        .filter(e => e.href && e.text)
    );
    console.log('Links:', JSON.stringify(links, null, 2));
    
    await page.screenshot({ path: '/tmp/mlh-signin.png', fullPage: true });
    console.log('Screenshot saved');
    
  } catch(e) {
    console.error('Error:', e.message);
    await page.screenshot({ path: '/tmp/mlh-signin.png' });
  }
  
  await browser.close();
})();
