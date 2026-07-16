const { chromium } = require('playwright');

const EMAIL = 'xiaowceo2026@deltajohnsons.com';
const EMAIL_PASSWORD = 'Hackfest2026Pass!';

async function getMailToken(page) {
  return await page.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    const j = await r.json();
    return j.token;
  }, { email: EMAIL, password: EMAIL_PASSWORD });
}

async function clearInbox(page, token) {
  const msgs = await page.evaluate(async (t) => {
    const r = await fetch('https://api.mail.tm/messages', {
      headers: { 'Authorization': 'Bearer ' + t }
    });
    const j = await r.json();
    return (j['hydra:member'] || []).map(m => m.id);
  }, token);
  
  for (const id of msgs) {
    await page.evaluate(async (data) => {
      await fetch('https://api.mail.tm/messages/' + data.id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + data.token }
      });
    }, { id, token });
  }
  console.log('Cleared', msgs.length, 'old emails');
}

async function waitForNewOTP(page, token, maxWait) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const msgs = await page.evaluate(async (t) => {
      const r = await fetch('https://api.mail.tm/messages', {
        headers: { 'Authorization': 'Bearer ' + t }
      });
      return await r.json();
    }, token);
    
    const items = msgs['hydra:member'] || [];
    if (items.length > 0) {
      const msg = await page.evaluate(async (data) => {
        const r = await fetch('https://api.mail.tm/messages/' + data.id, {
          headers: { 'Authorization': 'Bearer ' + data.token }
        });
        return await r.json();
      }, { id: items[0].id, token });
      
      const text = msg.text || '';
      const match = text.match(/(\d{6})/);
      if (match) return match[1];
    }
    
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log('Waiting for OTP email... (' + elapsed + 's)');
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  
  // Use a helper page for mail API calls
  const mailPage = await context.newPage();
  await mailPage.goto('about:blank');
  
  const token = await getMailToken(mailPage);
  console.log('Mail token:', !!token);
  
  // Clear old emails first
  await clearInbox(mailPage, token);
  
  // MLH registration page
  const page = await context.newPage();
  console.log('Going to MLH sign in...');
  await page.goto('https://my.mlh.io/signin', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  // Submit email
  await page.fill('#signin-email', EMAIL);
  const btn = await page.$('button[type="submit"]');
  console.log('Submitting email...');
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    btn.click()
  ]);
  await page.waitForTimeout(1000);
  
  console.log('URL:', page.url());
  
  if (!page.url().includes('otp')) {
    console.log('Not on OTP page. Content:', await page.evaluate(() => document.body.innerText.substring(0, 500)));
    await browser.close();
    return;
  }
  
  console.log('On OTP page, waiting for email...');
  
  // Wait for OTP email
  const otp = await waitForNewOTP(mailPage, token, 60000);
  
  if (!otp) {
    console.log('FAILED: No OTP received');
    await browser.close();
    return;
  }
  
  console.log('Got OTP:', otp);
  
  // Enter OTP
  for (let i = 0; i < 6; i++) {
    await page.fill('#otp' + i, otp[i]);
  }
  await page.waitForTimeout(500);
  
  // Submit
  const continueBtn = await page.$('button:has-text("Continue")');
  if (continueBtn) {
    console.log('Clicking Continue...');
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      continueBtn.click()
    ]);
  }
  
  await page.waitForTimeout(3000);
  console.log('URL after OTP:', page.url());
  
  const content = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Content:', content);
  
  const fields = await page.$$eval('input, select, textarea', els => 
    els.map(e => ({ 
      type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, tag: e.tagName
    }))
  );
  console.log('Fields:', JSON.stringify(fields, null, 2));
  
  // Check for cookies/session
  const cookies = await context.cookies();
  console.log('Cookies:', cookies.map(c => c.name + '=' + c.value.substring(0, 20) + '...').join(', '));
  
  await page.screenshot({ path: '/tmp/mlh-after-otp-success.png', fullPage: true });
  console.log('Screenshot saved');
  
  await browser.close();
})();
