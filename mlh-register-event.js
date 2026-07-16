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
  
  // Sign in
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
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
    console.log('Not OTP page:', txt);
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
  console.log('After OTP:', page.url());
  
  // If on profile page, it means account already created - go to event directly
  if (page.url().includes('my.mlh.io') && !page.url().includes('onboarding')) {
    console.log('Already logged in!');
  }
  
  // If still on onboarding (shouldn't be since we completed it before)
  if (page.url().includes('onboarding')) {
    console.log('Still on onboarding, completing...');
    await page.fill('input[name="firstName"]', 'Xiao');
    await page.fill('input[name="lastName"]', 'W');
    await page.click('#acceptsTerms');
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      page.click('button:has-text("Sign Up!")')
    ]);
    await page.waitForTimeout(2000);
  }
  
  // Navigate to AI Hackfest registration
  console.log('Going to AI Hackfest...');
  await page.goto('https://events.mlh.io/events/13503-ai-hackfest', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(3000);
  console.log('Event page URL:', page.url());
  
  // Look at the full page structure
  const pageHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 15000));
  
  // Find all checkboxes, selects, and form elements
  const formElements = await page.$$eval('input, select, textarea, button[role="checkbox"]', els => 
    els.map(e => ({
      type: e.type || e.tagName,
      name: e.name || '',
      id: e.id || '',
      tag: e.tagName,
      role: e.getAttribute('role') || '',
      text: (e.labels && e.labels[0] ? e.labels[0].textContent : e.textContent || '').trim().substring(0, 100),
      options: e.tagName === 'SELECT' ? Array.from(e.options).map(o => ({ value: o.value, text: o.text })) : undefined
    }))
  );
  console.log('All form elements:', JSON.stringify(formElements, null, 2));
  
  // Check for Register & Check-in link
  const registerLink = await page.$('a:has-text("Register & Check-in")');
  if (registerLink) {
    console.log('Found Register & Check-in link, clicking...');
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      registerLink.click()
    ]);
    await page.waitForTimeout(2000);
    console.log('After click URL:', page.url());
  }
  
  // Now look for the registration form (it was shown as modal/inline in previous run)
  // Check for checkboxes for the registration questions
  const checkboxButtons = await page.$$('button[role="checkbox"]');
  console.log('Checkbox buttons found:', checkboxButtons.length);
  
  // Get all text near checkboxes
  for (let i = 0; i < checkboxButtons.length; i++) {
    const info = await checkboxButtons[i].evaluate(el => ({
      id: el.id,
      ariaChecked: el.getAttribute('aria-checked'),
      nearText: el.parentElement ? el.parentElement.textContent.trim().substring(0, 150) : ''
    }));
    console.log(`Checkbox ${i}:`, JSON.stringify(info));
  }
  
  // Find select elements
  const selects = await page.$$('select');
  console.log('Selects found:', selects.length);
  
  // Take screenshot to see current state
  await page.screenshot({ path: '/tmp/mlh-event-state.png', fullPage: true });
  
  // Try to fill the registration form
  // 1. Check all required checkboxes (age, terms, code of conduct)
  for (const cb of checkboxButtons) {
    const checked = await cb.evaluate(el => el.getAttribute('aria-checked'));
    if (checked !== 'true') {
      await cb.click();
      await page.waitForTimeout(200);
    }
  }
  console.log('All checkboxes checked');
  
  // 2. Select region: APAC
  for (const sel of selects) {
    const name = await sel.evaluate(el => el.name || el.id || '');
    const options = await sel.evaluate(el => Array.from(el.options).map(o => o.text));
    console.log('Select', name, 'options:', options);
    
    if (options.some(o => o.includes('APAC') || o.includes('Asia'))) {
      await sel.selectOption({ label: options.find(o => o.includes('APAC') || o.includes('Asia')) });
      console.log('Selected APAC');
    } else if (options.some(o => o.includes('Search Engine'))) {
      await sel.selectOption({ label: 'Search Engine' });
      console.log('Selected Search Engine');
    } else if (options.some(o => o.includes('Yes'))) {
      await sel.selectOption({ label: 'Yes' });
      console.log('Selected Yes');
    }
  }
  
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/mlh-form-filled.png', fullPage: true });
  
  // 3. Find and click the final register/submit button
  const submitBtn = await page.$('button:has-text("Register"), button[type="submit"]:has-text("Register"), input[type="submit"]');
  if (submitBtn) {
    console.log('Found submit button, clicking...');
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      submitBtn.click()
    ]);
    await page.waitForTimeout(3000);
  } else {
    // Try other buttons
    const allBtns = await page.$$eval('button', els => els.map(e => e.textContent.trim().substring(0, 50)));
    console.log('All buttons:', allBtns);
    
    // Try clicking any submit-looking button
    const regBtn = await page.$('button:has-text("Submit"), button:has-text("RSVP"), button:has-text("Check")');
    if (regBtn) {
      await Promise.all([
        page.waitForNavigation({ timeout: 15000 }).catch(() => null),
        regBtn.click()
      ]);
      await page.waitForTimeout(3000);
    }
  }
  
  console.log('Final URL:', page.url());
  const finalContent = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Final content:', finalContent);
  
  await page.screenshot({ path: '/tmp/mlh-final-result.png', fullPage: true });
  
  await browser.close();
})();
