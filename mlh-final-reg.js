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
  await page.waitForTimeout(2000);
  console.log('Logged in. URL:', page.url());
  
  // Go to event page
  console.log('Going to AI Hackfest...');
  await page.goto('https://events.mlh.io/events/13503-ai-hackfest', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(2000);
  
  // Now fill the registration form directly (it's embedded in the page)
  // 1. Check checkboxes using their IDs
  console.log('Checking checkboxes...');
  await page.check('#accepted_18_or_over');
  console.log('  ✓ Age confirmation');
  
  await page.check('#accepted_event_terms');
  console.log('  ✓ Event terms');
  
  await page.check('#accepted_code_of_conduct');
  console.log('  ✓ Code of conduct');
  
  // Optional: newsletter
  // await page.check('#accepted_newsletter_optin');
  
  // 2. Select region
  await page.selectOption('#participation_event_questions_form_participant_region', 'Asia Pacific (APAC)');
  console.log('  ✓ Region: APAC');
  
  // 3. Select how heard
  await page.selectOption('#participation_event_questions_form_signup_source', 'Search Engine');
  console.log('  ✓ Source: Search Engine');
  
  // 4. Address form radio - select "Yes"
  await page.check('#participation_event_questions_form_have_you_already_com_5bd6_true');
  console.log('  ✓ Address form: Yes');
  
  await page.waitForTimeout(500);
  
  // Verify all values
  const formState = await page.evaluate(() => {
    return {
      age: document.querySelector('#accepted_18_or_over')?.checked,
      terms: document.querySelector('#accepted_event_terms')?.checked,
      coc: document.querySelector('#accepted_code_of_conduct')?.checked,
      region: document.querySelector('#participation_event_questions_form_participant_region')?.value,
      source: document.querySelector('#participation_event_questions_form_signup_source')?.value,
      addressYes: document.querySelector('#participation_event_questions_form_have_you_already_com_5bd6_true')?.checked,
    };
  });
  console.log('Form state:', JSON.stringify(formState));
  
  await page.screenshot({ path: '/tmp/mlh-form-ready.png', fullPage: true });
  
  // 5. Submit!
  console.log('Submitting registration...');
  const submitBtn = await page.$('input[type="submit"][name="commit"]');
  if (submitBtn) {
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      submitBtn.click()
    ]);
  } else {
    // Fallback: submit the form directly
    await page.evaluate(() => {
      const form = document.querySelector('form[action*="participation"]') || document.querySelector('form');
      if (form) form.submit();
    });
  }
  
  await page.waitForTimeout(5000);
  console.log('\n=== RESULT ===');
  console.log('Final URL:', page.url());
  const finalContent = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Content:', finalContent);
  
  await page.screenshot({ path: '/tmp/mlh-registered.png', fullPage: true });
  
  // Check if registration was successful
  if (finalContent.includes('registered') || finalContent.includes('checked in') || 
      finalContent.includes('Unlocked') || finalContent.includes('success') ||
      finalContent.includes('Discord') && finalContent.includes('Unlocked')) {
    console.log('\n🎉 REGISTRATION SUCCESSFUL!');
  } else if (finalContent.includes('error') || finalContent.includes("can't be blank")) {
    console.log('\n❌ Registration failed - errors present');
  } else {
    console.log('\n? Unknown state');
  }
  
  await browser.close();
})();
