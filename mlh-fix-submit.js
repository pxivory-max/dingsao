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
    console.log('Error:', await page.evaluate(() => document.body.innerText.substring(0, 300)));
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
  await page.waitForTimeout(3000);
  console.log('After OTP URL:', page.url());
  
  // Go to event page with register intent
  console.log('Going to AI Hackfest...');
  await page.goto('https://events.mlh.io/events/13503-ai-hackfest?intent=register', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(3000);
  
  // First, inspect the hidden status field to see its default value
  const statusInfo = await page.evaluate(() => {
    const s = document.querySelector('#participation_status');
    return s ? { value: s.value, name: s.name } : null;
  });
  console.log('Status field:', JSON.stringify(statusInfo));
  
  // Check the form action and method, and dump all hidden fields
  const formInfo = await page.evaluate(() => {
    const form = document.querySelector('form[action*="registration"]') ||
                 Array.from(document.forms).find(f => f.innerHTML.includes('accepted_18_or_over'));
    if (!form) return null;
    const hiddens = Array.from(form.querySelectorAll('input[type="hidden"]')).map(i => ({
      name: i.name, value: i.value
    }));
    return { action: form.action, method: form.method, hiddens };
  });
  console.log('Form info:', JSON.stringify(formInfo, null, 2));
  
  // Fill form - DO NOT touch the hidden status field
  console.log('Filling form...');
  const fillResult = await page.evaluate(() => {
    const form = document.querySelector('form[action*="registration"]') ||
                 Array.from(document.forms).find(f => f.innerHTML.includes('accepted_18_or_over'));
    if (!form) return { error: 'no form' };
    
    // Check all required checkboxes
    ['#accepted_18_or_over', '#accepted_event_terms', '#accepted_code_of_conduct'].forEach(sel => {
      const el = form.querySelector(sel);
      if (el) el.checked = true;
    });
    
    // Address form: Yes
    const addrYes = form.querySelector('#participation_event_questions_form_have_you_already_com_5bd6_true');
    if (addrYes) addrYes.checked = true;
    
    // Region: APAC
    const region = form.querySelector('#participation_event_questions_form_participant_region');
    if (region) region.value = 'Asia Pacific (APAC)';
    
    // Source
    const source = form.querySelector('#participation_event_questions_form_signup_source');
    if (source) source.value = 'Search Engine';
    
    return { filled: true };
  });
  console.log('Fill result:', JSON.stringify(fillResult));
  
  // Now use the actual submit button (input[type="submit"]) and click it
  // This is key — use the button, not form.submit(), because the button sets the status value
  console.log('Clicking submit via input[type="submit"]...');
  
  // The submit button likely has a data attribute or sets status
  const submitInfo = await page.evaluate(() => {
    const btn = document.querySelector('input[type="submit"][name="commit"]');
    return btn ? { value: btn.value, name: btn.name, visible: btn.offsetParent !== null } : null;
  });
  console.log('Submit button:', JSON.stringify(submitInfo));
  
  // Click with force since it might be in a modal
  try {
    await page.click('input[type="submit"][name="commit"]', { force: true, timeout: 5000 });
  } catch(e) {
    console.log('Click failed, trying form.requestSubmit()...');
    await page.evaluate(() => {
      const form = document.querySelector('form[action*="registration"]') ||
                   Array.from(document.forms).find(f => f.innerHTML.includes('accepted_18_or_over'));
      if (form) {
        const btn = form.querySelector('input[type="submit"]');
        if (btn) btn.click();
      }
    });
  }
  
  await page.waitForTimeout(5000);
  
  console.log('\n=== RESULT ===');
  console.log('Final URL:', page.url());
  const finalContent = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Content:', finalContent);
  
  await page.screenshot({ path: '/tmp/mlh-final2.png', fullPage: true });
  
  // Success check
  const urlHasError = page.url().includes('error');
  const contentLower = finalContent.toLowerCase();
  if (!urlHasError && (contentLower.includes('registered') || contentLower.includes('you are checked in'))) {
    console.log('\n🎉 REGISTRATION SUCCESSFUL!');
  } else if (urlHasError) {
    console.log('\n❌ Error in URL:', decodeURIComponent(page.url().split('?')[1] || ''));
  } else {
    console.log('\n? Check screenshot');
  }
  
  await browser.close();
})();
