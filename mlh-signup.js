const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  console.log('Go to sign in page first...');
  await page.goto('https://events.mlh.io/sign_in', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  // Click Sign Up link
  console.log('Looking for Sign Up...');
  const signUpLink = await page.$('text=Sign Up');
  if (signUpLink) {
    await signUpLink.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const title = await page.title();
    console.log('Page title:', title);
    console.log('URL:', page.url());
    
    const content = await page.evaluate(() => document.body.innerText.substring(0, 5000));
    console.log('Page content:', content);
    
    const inputs = await page.$$eval('input, select, textarea', els => 
      els.map(e => ({ 
        type: e.type, 
        name: e.name, 
        id: e.id, 
        placeholder: e.placeholder,
        required: e.required,
        tag: e.tagName,
        options: e.tagName === 'SELECT' ? Array.from(e.options).slice(0,5).map(o => o.text) : undefined
      }))
    );
    console.log('Form fields:', JSON.stringify(inputs, null, 2));
    
    await page.screenshot({ path: '/tmp/mlh-signup.png', fullPage: true });
    console.log('Screenshot saved');
  } else {
    console.log('Sign Up link not found');
  }
  
  await browser.close();
})();
