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
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + data.token }
      });
    }, { id, token });
  }
  return msgs.length;
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
    console.log('  Waiting... (' + Math.round((Date.now() - start) / 1000) + 's)');
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

async function tryRegister(attempt) {
  console.log(`\n=== Attempt ${attempt} ===`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  
  const mailPage = await ctx.newPage();
  await mailPage.goto('about:blank');
  const token = await getMailToken(mailPage);
  const cleared = await clearInbox(mailPage, token);
  console.log('Cleared', cleared, 'old emails');
  
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
  
  const url = page.url();
  const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
  
  if (text.includes('recently sent') || text.includes('wait')) {
    console.log('Rate limited, need to wait more');
    await browser.close();
    return 'rate_limited';
  }
  
  if (!url.includes('otp')) {
    console.log('Unexpected state:', url, text.substring(0, 200));
    await browser.close();
    return 'error';
  }
  
  console.log('OTP page! Waiting for email...');
  const otp = await waitForNewOTP(mailPage, token, 60000);
  
  if (!otp) {
    console.log('No OTP received');
    await browser.close();
    return 'no_otp';
  }
  
  console.log('Got OTP:', otp);
  
  for (let i = 0; i < 6; i++) {
    await page.fill('#otp' + i, otp[i]);
  }
  await page.waitForTimeout(500);
  
  const continueBtn = await page.$('button:has-text("Continue")');
  if (continueBtn) {
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      continueBtn.click()
    ]);
  }
  
  await page.waitForTimeout(3000);
  const finalUrl = page.url();
  const finalContent = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  
  console.log('Final URL:', finalUrl);
  console.log('Final content:', finalContent);
  
  const fields = await page.$$eval('input, select, textarea', els => 
    els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, tag: e.tagName }))
  );
  console.log('Fields:', JSON.stringify(fields, null, 2));
  
  await page.screenshot({ path: '/tmp/mlh-success.png', fullPage: true });
  
  // If we need to fill profile
  if (finalContent.includes('First Name') || finalContent.includes('profile') || fields.some(f => f.name && f.name.includes('name'))) {
    console.log('\n=== PROFILE FORM DETECTED ===');
    // We'll handle this in the next step
  }
  
  await browser.close();
  return 'success';
}

(async () => {
  // Wait 3 minutes for rate limit to expire, then try
  console.log('Waiting 3 minutes for rate limit to clear...');
  await new Promise(r => setTimeout(r, 180000));
  
  const result = await tryRegister(1);
  if (result === 'rate_limited') {
    console.log('Still rate limited, waiting 2 more minutes...');
    await new Promise(r => setTimeout(r, 120000));
    await tryRegister(2);
  }
})();
