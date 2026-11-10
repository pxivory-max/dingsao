const mailboxPassword = require('./mail-config').password;
const { chromium } = require('playwright');

const EMAIL = 'xiaowceo2026@deltajohnsons.com';
const EMAIL_PASSWORD = mailboxPassword;

async function getMailToken(page) {
  return await page.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return (await r.json()).token;
  }, { email: EMAIL, password: EMAIL_PASSWORD });
}

async function clearAllMail(page, token) {
  const msgs = await page.evaluate(async (t) => {
    const r = await fetch('https://api.mail.tm/messages', { headers: { 'Authorization': 'Bearer ' + t } });
    return (await r.json())['hydra:member'] || [];
  }, token);
  for (const m of msgs) {
    await page.evaluate(async (d) => {
      await fetch('https://api.mail.tm/messages/' + d.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + d.token } });
    }, { id: m.id, token });
  }
  return msgs.length;
}

async function waitForOTP(page, token, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const msgs = await page.evaluate(async (t) => {
      const r = await fetch('https://api.mail.tm/messages', { headers: { 'Authorization': 'Bearer ' + t } });
      return (await r.json())['hydra:member'] || [];
    }, token);
    if (msgs.length > 0) {
      const full = await page.evaluate(async (d) => {
        const r = await fetch('https://api.mail.tm/messages/' + d.id, { headers: { 'Authorization': 'Bearer ' + d.token } });
        return await r.json();
      }, { id: msgs[0].id, token });
      const m = (full.text || '').match(/(\d{6})/);
      if (m) return m[1];
    }
    console.log('  Waiting for OTP... ' + Math.round((Date.now() - start) / 1000) + 's');
    await new Promise(r => setTimeout(r, 2500));
  }
  return null;
}

(async () => {
  console.log('Starting MLH registration...');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  
  // Helper page for mail API
  const mp = await ctx.newPage();
  await mp.goto('about:blank');
  const token = await getMailToken(mp);
  console.log('Mail token ready');
  
  // Clear all old emails FIRST
  const cleared = await clearAllMail(mp, token);
  console.log('Cleared', cleared, 'old emails');
  
  // Wait a moment to ensure clean state
  await new Promise(r => setTimeout(r, 2000));
  
  // Verify inbox is empty
  const check = await mp.evaluate(async (t) => {
    const r = await fetch('https://api.mail.tm/messages', { headers: { 'Authorization': 'Bearer ' + t } });
    return ((await r.json())['hydra:member'] || []).length;
  }, token);
  console.log('Inbox count after clear:', check);
  
  // Now go to MLH
  const page = await ctx.newPage();
  await page.goto('https://my.mlh.io/signin', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  // Check if rate limited before submitting
  await page.fill('#signin-email', EMAIL);
  const btn = await page.$('button[type="submit"]');
  
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    btn.click()
  ]);
  await page.waitForTimeout(2000);
  
  const pageText = await page.evaluate(() => document.body.innerText);
  if (pageText.includes('recently sent') || pageText.includes('wait')) {
    console.log('RATE LIMITED. Exiting.');
    await browser.close();
    return;
  }
  
  if (!page.url().includes('otp')) {
    console.log('Not on OTP page:', page.url());
    console.log(pageText.substring(0, 300));
    await browser.close();
    return;
  }
  
  console.log('On OTP page! Waiting for fresh email...');
  
  // Wait for OTP
  const otp = await waitForOTP(mp, token, 60000);
  if (!otp) {
    console.log('NO OTP RECEIVED');
    await browser.close();
    return;
  }
  
  console.log('OTP:', otp);
  
  // KEY FIX: Use keyboard.type() instead of fill() to trigger React state updates
  // First click the first input to focus it
  await page.click('#otp0');
  await page.waitForTimeout(200);
  
  // Type all 6 digits one by one using keyboard
  for (let i = 0; i < 6; i++) {
    await page.keyboard.type(otp[i], { delay: 50 });
    await page.waitForTimeout(100);
  }
  
  await page.waitForTimeout(1000);
  
  // Click Continue
  const continueBtn = await page.$('button:has-text("Continue")');
  if (continueBtn) {
    console.log('Clicking Continue...');
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      continueBtn.click()
    ]);
  }
  
  await page.waitForTimeout(3000);
  const finalUrl = page.url();
  console.log('Final URL:', finalUrl);
  
  const content = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Content:', content);
  
  const fields = await page.$$eval('input, select, textarea', els => 
    els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder }))
  );
  console.log('Fields:', JSON.stringify(fields, null, 2));
  
  await page.screenshot({ path: '/tmp/mlh-final-attempt.png', fullPage: true });
  console.log('Screenshot saved');
  
  await browser.close();
})();
