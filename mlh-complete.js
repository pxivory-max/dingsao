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
  
  // Step 1: Sign in with OTP
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
    console.log('Not on OTP page:', await page.evaluate(() => document.body.innerText.substring(0, 300)));
    await browser.close();
    return;
  }
  
  console.log('Waiting for OTP...');
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
  
  console.log('URL after OTP:', page.url());
  
  // Step 2: Fill profile
  if (page.url().includes('onboarding')) {
    console.log('Filling profile...');
    
    // Fill First Name
    await page.fill('input[name="firstName"]', 'Xiao');
    await page.waitForTimeout(200);
    
    // Fill Last Name
    await page.fill('input[name="lastName"]', 'W');
    await page.waitForTimeout(200);
    
    // Check Terms checkbox
    const checkbox = await page.$('input[type="checkbox"]');
    if (checkbox) {
      await checkbox.check();
      await page.waitForTimeout(200);
    }
    
    console.log('Clicking Sign Up...');
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      page.click('button:has-text("Sign Up")')
    ]);
    
    await page.waitForTimeout(3000);
    console.log('URL after signup:', page.url());
    const content = await page.evaluate(() => document.body.innerText.substring(0, 5000));
    console.log('Content:', content);
    
    await page.screenshot({ path: '/tmp/mlh-profile-done.png', fullPage: true });
  }
  
  // Step 3: Register for AI Hackfest event
  console.log('\nNavigating to AI Hackfest registration...');
  await page.goto('https://events.mlh.io/events/13503-ai-hackfest/register', { 
    waitUntil: 'networkidle', timeout: 30000 
  });
  await page.waitForTimeout(3000);
  
  console.log('URL:', page.url());
  const eventContent = await page.evaluate(() => document.body.innerText.substring(0, 5000));
  console.log('Event page content:', eventContent);
  
  const eventFields = await page.$$eval('input, select, textarea', els => 
    els.map(e => ({ 
      type: e.type, name: e.name, id: e.id, placeholder: e.placeholder,
      tag: e.tagName, label: e.labels && e.labels[0] ? e.labels[0].textContent : ''
    }))
  );
  console.log('Event fields:', JSON.stringify(eventFields, null, 2));
  
  await page.screenshot({ path: '/tmp/mlh-event-register.png', fullPage: true });
  
  // Save cookies for later use
  const cookies = await ctx.cookies();
  const fs = require('fs');
  fs.writeFileSync('/tmp/mlh-cookies.json', JSON.stringify(cookies, null, 2));
  console.log('Cookies saved');
  
  await browser.close();
})();
