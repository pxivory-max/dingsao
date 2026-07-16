const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  // Step 1: Create temp email on mail.tm
  console.log('Creating temp email...');
  const email = 'xiaowceo2026@deltajohnsons.com';
  const password = 'Hackfest2026Pass!';
  
  const createResp = await page.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return { status: r.status, body: await r.text() };
  }, { email, password });
  console.log('Create email:', createResp.status, createResp.body.substring(0, 200));
  
  // Get token
  const tokenResp = await page.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return { status: r.status, body: await r.text() };
  }, { email, password });
  console.log('Token:', tokenResp.status, tokenResp.body.substring(0, 100));
  
  if (tokenResp.status !== 200) {
    console.log('Token failed, cannot check emails later');
  }
  const token = tokenResp.status === 200 ? JSON.parse(tokenResp.body).token : null;
  
  // Step 2: Go to MLH signup
  console.log('\nNavigating to MLH signup...');
  await page.goto('https://my.mlh.io/signup', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  // Fill and submit
  await page.fill('#signin-email', email);
  
  // Check what the form action looks like
  const formInfo = await page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) return { action: form.action, method: form.method };
    return null;
  });
  console.log('Form info:', JSON.stringify(formInfo));
  
  // Try clicking submit
  const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Sign Up")');
  if (submitBtn) {
    // Listen for navigation
    const [response] = await Promise.all([
      page.waitForNavigation({ timeout: 10000 }).catch(e => null),
      submitBtn.click()
    ]);
    console.log('Navigation response:', response ? response.url() : 'no navigation');
  }
  
  await page.waitForTimeout(3000);
  console.log('Current URL:', page.url());
  
  const content = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Page content:', content);
  
  const fields = await page.$$eval('input, select, textarea', els => 
    els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder }))
  );
  console.log('Fields:', JSON.stringify(fields, null, 2));
  
  await page.screenshot({ path: '/tmp/mlh-signup2.png', fullPage: true });
  console.log('Screenshot saved');
  
  // Save info
  console.log('\n=== INFO ===');
  console.log('Email:', email);
  console.log('Password:', password);
  console.log('Has token:', !!token);
  
  await browser.close();
})();
