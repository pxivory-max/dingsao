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
    await new Promise(r => setTimeout(r, 2500));
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  
  const mp = await ctx.newPage();
  await mp.goto('about:blank');
  const token = await getMailToken(mp);
  await clearAllMail(mp, token);
  
  const page = await ctx.newPage();
  
  console.log('Signing in...');
  await page.goto('https://my.mlh.io/signin', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.fill('#signin-email', EMAIL);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    page.click('button[type="submit"]')
  ]);
  await page.waitForTimeout(2000);
  
  if (!page.url().includes('otp')) {
    console.log('Rate limited or error:', await page.evaluate(() => document.body.innerText.substring(0, 300)));
    await browser.close();
    return;
  }
  
  const otp = await waitForOTP(mp, token, 60000);
  if (!otp) { console.log('No OTP'); await browser.close(); return; }
  console.log('OTP:', otp);
  
  await page.click('#otp0');
  await page.waitForTimeout(200);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.type(otp[i], { delay: 80 });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  
  await Promise.all([
    page.waitForNavigation({ timeout: 20000 }).catch(() => null),
    page.click('button:has-text("Continue")')
  ]);
  await page.waitForTimeout(2000);
  console.log('After OTP URL:', page.url());
  
  if (page.url().includes('onboarding')) {
    console.log('Filling profile...');
    await page.fill('input[name="firstName"]', 'Xiao');
    await page.fill('input[name="lastName"]', 'W');
    
    // Use JavaScript to check the checkbox (bypasses overlay issues)
    await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);
    
    // Also try clicking the label/text near checkbox
    try {
      await page.click('text=Terms of Service', { timeout: 3000 });
    } catch(e) {
      // Try clicking parent of checkbox
      await page.evaluate(() => {
        const cb = document.querySelector('input[type="checkbox"]');
        if (cb && cb.parentElement) cb.parentElement.click();
      });
    }
    await page.waitForTimeout(500);
    
    // Verify checkbox state
    const checked = await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"]');
      return cb ? cb.checked : 'no checkbox';
    });
    console.log('Checkbox checked:', checked);
    
    // Click Sign Up
    console.log('Clicking Sign Up...');
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      page.click('button:has-text("Sign Up!")')
    ]);
    
    await page.waitForTimeout(3000);
    console.log('After signup URL:', page.url());
    console.log('Content:', await page.evaluate(() => document.body.innerText.substring(0, 3000)));
    await page.screenshot({ path: '/tmp/mlh-after-profile.png', fullPage: true });
  }
  
  // Step 3: Go to AI Hackfest registration
  console.log('\nGoing to event registration...');
  await page.goto('https://events.mlh.io/events/13503-ai-hackfest/register', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(3000);
  
  console.log('Event URL:', page.url());
  const eventContent = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Event content:', eventContent);
  
  const fields = await page.$$eval('input, select, textarea, button', els => 
    els.map(e => ({ type: e.type, name: e.name || '', id: e.id, text: e.textContent.trim().substring(0, 50), tag: e.tagName }))
  );
  console.log('Fields:', JSON.stringify(fields, null, 2));
  
  // Try to find and click Register/RSVP button
  const regBtn = await page.$('button:has-text("Register"), button:has-text("RSVP"), a:has-text("Register"), input[type="submit"]');
  if (regBtn) {
    console.log('Found register button, clicking...');
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      regBtn.click()
    ]);
    await page.waitForTimeout(3000);
    console.log('After register URL:', page.url());
    console.log('Content:', await page.evaluate(() => document.body.innerText.substring(0, 3000)));
  }
  
  await page.screenshot({ path: '/tmp/mlh-event-final.png', fullPage: true });
  
  const cookies = await ctx.cookies();
  require('fs').writeFileSync('/tmp/mlh-cookies.json', JSON.stringify(cookies, null, 2));
  console.log('Cookies saved');
  
  await browser.close();
})();
