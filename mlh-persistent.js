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

async function attemptRegistration() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  
  const mp = await ctx.newPage();
  await mp.goto('about:blank');
  const token = await getMailToken(mp);
  await clearAllMail(mp, token);
  
  const page = await ctx.newPage();
  await page.goto('https://my.mlh.io/signin', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  await page.fill('#signin-email', EMAIL);
  const btn = await page.$('button[type="submit"]');
  
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    btn.click()
  ]);
  await page.waitForTimeout(2000);
  
  const pageText = await page.evaluate(() => document.body.innerText);
  if (pageText.includes('recently sent') || pageText.includes('wait')) {
    console.log('Still rate limited');
    await browser.close();
    return 'rate_limited';
  }
  
  if (!page.url().includes('otp')) {
    console.log('Not on OTP page:', page.url());
    await browser.close();
    return 'error';
  }
  
  console.log('On OTP page! Waiting for email...');
  const otp = await waitForOTP(mp, token, 60000);
  if (!otp) {
    await browser.close();
    return 'no_otp';
  }
  
  console.log('OTP:', otp);
  
  // Use keyboard.type to trigger React onChange properly
  await page.click('#otp0');
  await page.waitForTimeout(200);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.type(otp[i], { delay: 80 });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1000);
  
  const continueBtn = await page.$('button:has-text("Continue")');
  if (continueBtn) {
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      continueBtn.click()
    ]);
  }
  
  await page.waitForTimeout(3000);
  console.log('Final URL:', page.url());
  const content = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Content:', content);
  
  const fields = await page.$$eval('input, select, textarea', els => 
    els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder }))
  );
  console.log('Fields:', JSON.stringify(fields, null, 2));
  
  await page.screenshot({ path: '/tmp/mlh-result.png', fullPage: true });
  
  // If we got to a profile page, try to fill it
  if (content.includes('First') || content.includes('profile') || page.url().includes('profile') || page.url().includes('register')) {
    console.log('=== PROFILE/REGISTER PAGE DETECTED ===');
    // Will handle next
  }
  
  await browser.close();
  return page.url().includes('otp') ? 'otp_failed' : 'success';
}

(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`\n=== Attempt ${attempt} ===`);
    const result = await attemptRegistration();
    console.log('Result:', result);
    
    if (result === 'success' || result === 'otp_failed') break;
    if (result === 'rate_limited') {
      const waitMin = 3 + attempt * 2;
      console.log(`Waiting ${waitMin} minutes...`);
      await new Promise(r => setTimeout(r, waitMin * 60 * 1000));
    }
  }
})();
