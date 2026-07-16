const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  
  // Step 1: Get a temporary email from mail.tm
  console.log('Step 1: Getting temporary email...');
  const mailPage = await context.newPage();
  
  // Use mail.tm API directly
  const apiPage = await context.newPage();
  
  // Create account on mail.tm via API
  // First get domains
  const domainsResp = await apiPage.evaluate(async () => {
    const r = await fetch('https://api.mail.tm/domains');
    return await r.json();
  });
  console.log('Available domains:', JSON.stringify(domainsResp));
  
  if (!domainsResp || !domainsResp['hydra:member'] || domainsResp['hydra:member'].length === 0) {
    console.log('No domains available, trying alternative...');
    await browser.close();
    return;
  }
  
  const domain = domainsResp['hydra:member'][0].domain;
  const emailAddr = `xiaow.ceo.${Date.now()}@${domain}`;
  const password = 'XiaoW_MLH_2026!';
  
  console.log('Creating email account:', emailAddr);
  
  const createResp = await apiPage.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return { status: r.status, body: await r.json() };
  }, { email: emailAddr, password });
  
  console.log('Create account result:', JSON.stringify(createResp));
  
  if (createResp.status !== 201) {
    console.log('Failed to create email account');
    await browser.close();
    return;
  }
  
  // Get auth token
  const tokenResp = await apiPage.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return { status: r.status, body: await r.json() };
  }, { email: emailAddr, password });
  
  console.log('Token result status:', tokenResp.status);
  const token = tokenResp.body.token;
  
  // Step 2: Register on MLH with this email
  console.log('\nStep 2: Registering on MLH...');
  const mlhPage = await context.newPage();
  await mlhPage.goto('https://my.mlh.io/signup', { waitUntil: 'networkidle', timeout: 30000 });
  await mlhPage.waitForTimeout(1000);
  
  // Fill email
  await mlhPage.fill('#signin-email', emailAddr);
  console.log('Filled email:', emailAddr);
  
  // Click Sign Up button
  await mlhPage.click('button:has-text("Sign Up"), input[type="submit"]');
  await mlhPage.waitForLoadState('networkidle');
  await mlhPage.waitForTimeout(3000);
  
  const afterSignup = await mlhPage.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('After signup click:', afterSignup);
  
  // Check for form fields (MLH usually asks for more info after email)
  const fields = await mlhPage.$$eval('input, select, textarea', els => 
    els.map(e => ({ 
      type: e.type, name: e.name, id: e.id, 
      placeholder: e.placeholder, required: e.required 
    }))
  );
  console.log('Fields after signup:', JSON.stringify(fields, null, 2));
  
  await mlhPage.screenshot({ path: '/tmp/mlh-after-signup.png', fullPage: true });
  console.log('Screenshot saved');
  
  // Save credentials
  console.log('\n=== CREDENTIALS ===');
  console.log('Temp Email:', emailAddr);
  console.log('Email Password:', password);
  console.log('Token:', token ? token.substring(0, 20) + '...' : 'none');
  
  await browser.close();
})();
