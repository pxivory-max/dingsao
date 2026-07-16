const { chromium } = require('playwright');

const EMAIL = 'xiaowceo2026@deltajohnsons.com';
const EMAIL_PASSWORD = 'Hackfest2026Pass!';

async function loginMLH(ctx) {
  const mp = await ctx.newPage();
  await mp.goto('about:blank');
  
  const token = await mp.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return (await r.json()).token;
  }, { email: EMAIL, password: EMAIL_PASSWORD });
  
  const msgs = await mp.evaluate(async (t) => {
    const r = await fetch('https://api.mail.tm/messages', { headers: { 'Authorization': 'Bearer ' + t } });
    return (await r.json())['hydra:member'] || [];
  }, token);
  for (const m of msgs) {
    await mp.evaluate(async (d) => {
      await fetch('https://api.mail.tm/messages/' + d.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + d.token } });
    }, { id: m.id, token });
  }
  
  const page = await ctx.newPage();
  await page.goto('https://my.mlh.io/signin', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.fill('#signin-email', EMAIL);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    page.click('button[type="submit"]')
  ]);
  await page.waitForTimeout(2000);
  
  if (!page.url().includes('otp')) return null;
  
  let otp = null;
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const msgs2 = await mp.evaluate(async (t) => {
      const r = await fetch('https://api.mail.tm/messages', { headers: { 'Authorization': 'Bearer ' + t } });
      return (await r.json())['hydra:member'] || [];
    }, token);
    if (msgs2.length > 0) {
      const full = await mp.evaluate(async (d) => {
        const r = await fetch('https://api.mail.tm/messages/' + d.id, { headers: { 'Authorization': 'Bearer ' + d.token } });
        return await r.json();
      }, { id: msgs2[0].id, token });
      const m = (full.text || '').match(/(\d{6})/);
      if (m) { otp = m[1]; break; }
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  if (!otp) return null;
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
  await mp.close();
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  
  console.log('Logging in...');
  const page = await loginMLH(ctx);
  if (!page) { console.log('Login failed'); await browser.close(); return; }
  console.log('Logged in');
  
  // Go to event with register intent
  await page.goto('https://events.mlh.io/events/13503-ai-hackfest?intent=register', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(3000);
  
  // Fill Form 1 (index 1) — the one with all the fields
  console.log('Filling registration form (form index 1)...');
  
  const fillResult = await page.evaluate(() => {
    const forms = document.forms;
    // Find the correct form — the one with checkboxes
    let form = null;
    for (let i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('#accepted_18_or_over')) {
        form = forms[i];
        break;
      }
    }
    if (!form) return { error: 'form not found' };
    
    // Check the checkboxes
    const age = form.querySelector('#accepted_18_or_over');
    const terms = form.querySelector('#accepted_event_terms');
    const coc = form.querySelector('#accepted_code_of_conduct');
    const addr = form.querySelector('#participation_event_questions_form_have_you_already_com_5bd6_true');
    const region = form.querySelector('#participation_event_questions_form_participant_region');
    const source = form.querySelector('#participation_event_questions_form_signup_source');
    
    if (age) age.checked = true;
    if (terms) terms.checked = true;
    if (coc) coc.checked = true;
    if (addr) addr.checked = true;
    if (region) region.value = 'Asia Pacific (APAC)';
    if (source) source.value = 'Search Engine';
    
    // Verify
    return {
      age: age?.checked,
      terms: terms?.checked,
      coc: coc?.checked,
      addr: addr?.checked,
      region: region?.value,
      source: source?.value,
      formAction: form.action,
      formIndex: Array.from(document.forms).indexOf(form)
    };
  });
  
  console.log('Fill result:', JSON.stringify(fillResult));
  
  if (fillResult.error) {
    console.log('FAILED:', fillResult.error);
    await browser.close();
    return;
  }
  
  // Now submit THIS specific form using requestSubmit
  console.log('Submitting...');
  await page.evaluate(() => {
    const forms = document.forms;
    let form = null;
    for (let i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('#accepted_18_or_over')) {
        form = forms[i];
        break;
      }
    }
    if (form) {
      const btn = form.querySelector('input[type="submit"]');
      if (btn) {
        btn.click();
      } else {
        form.requestSubmit();
      }
    }
  });
  
  await page.waitForNavigation({ timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(5000);
  
  console.log('\n=== RESULT ===');
  console.log('Final URL:', page.url());
  const content = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Content:', content);
  
  await page.screenshot({ path: '/tmp/mlh-victory.png', fullPage: true });
  
  const urlStr = page.url();
  if (urlStr.includes('error')) {
    console.log('\n❌ Errors:', decodeURIComponent(urlStr.split('?')[1] || '').substring(0, 500));
  } else if (content.includes('Check-In') || content.includes('checked in') || content.includes('Registered')) {
    console.log('\n🎉 REGISTRATION SUCCESSFUL!');
  } else {
    console.log('\n? Unknown state - check screenshot');
  }
  
  await browser.close();
})();
