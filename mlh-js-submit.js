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
  console.log('Event page URL:', page.url());
  
  // Check if modal is open (look for "Registration Questions" text)
  const hasModal = await page.evaluate(() => 
    document.body.innerText.includes('Registration Questions')
  );
  console.log('Modal open:', hasModal);
  
  if (!hasModal) {
    // Click "Register & Check-in" to open modal
    console.log('Opening registration modal...');
    const regLink = await page.$('a:has-text("Register"), button:has-text("Register")');
    if (regLink) {
      await regLink.click();
      await page.waitForTimeout(2000);
    }
  }
  
  // Use JavaScript to fill the form (bypass visibility issues)
  console.log('Filling form with JavaScript...');
  
  const result = await page.evaluate(() => {
    const form = document.querySelector('form[action*="participation"]') ||
                 Array.from(document.forms).find(f => f.innerHTML.includes('accepted_18_or_over'));
    
    if (!form) return { error: 'No form found', forms: document.forms.length };
    
    // Check all required checkboxes
    const ageCheck = form.querySelector('#accepted_18_or_over');
    const termsCheck = form.querySelector('#accepted_event_terms');
    const cocCheck = form.querySelector('#accepted_code_of_conduct');
    const addressYes = form.querySelector('#participation_event_questions_form_have_you_already_com_5bd6_true');
    
    if (ageCheck) { ageCheck.checked = true; ageCheck.dispatchEvent(new Event('change', { bubbles: true })); }
    if (termsCheck) { termsCheck.checked = true; termsCheck.dispatchEvent(new Event('change', { bubbles: true })); }
    if (cocCheck) { cocCheck.checked = true; cocCheck.dispatchEvent(new Event('change', { bubbles: true })); }
    if (addressYes) { addressYes.checked = true; addressYes.dispatchEvent(new Event('change', { bubbles: true })); }
    
    // Select region
    const regionSelect = form.querySelector('#participation_event_questions_form_participant_region');
    if (regionSelect) {
      regionSelect.value = 'Asia Pacific (APAC)';
      regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Select source
    const sourceSelect = form.querySelector('#participation_event_questions_form_signup_source');
    if (sourceSelect) {
      sourceSelect.value = 'Search Engine';
      sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    return {
      formFound: true,
      action: form.action,
      method: form.method,
      age: ageCheck?.checked,
      terms: termsCheck?.checked,
      coc: cocCheck?.checked,
      addressYes: addressYes?.checked,
      region: regionSelect?.value,
      source: sourceSelect?.value
    };
  });
  
  console.log('Form fill result:', JSON.stringify(result));
  
  if (result.error) {
    console.log('Form not found!');
    await page.screenshot({ path: '/tmp/mlh-no-form.png', fullPage: true });
    await browser.close();
    return;
  }
  
  await page.waitForTimeout(500);
  
  // Submit form via JavaScript
  console.log('Submitting form...');
  await page.evaluate(() => {
    const form = document.querySelector('form[action*="participation"]') ||
                 Array.from(document.forms).find(f => f.innerHTML.includes('accepted_18_or_over'));
    if (form) {
      // Set participation status
      const statusInput = form.querySelector('#participation_status');
      if (statusInput) statusInput.value = 'registered';
      
      form.submit();
    }
  });
  
  await page.waitForTimeout(5000);
  
  console.log('\n=== RESULT ===');
  console.log('Final URL:', page.url());
  const finalContent = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log('Content:', finalContent);
  
  await page.screenshot({ path: '/tmp/mlh-registered-final.png', fullPage: true });
  
  if (finalContent.toLowerCase().includes('registered') || finalContent.toLowerCase().includes('checked in') || 
      finalContent.includes('Unlocked when checked in') === false && finalContent.includes('Discord')) {
    console.log('\n🎉 REGISTRATION SUCCESSFUL!');
  } else if (page.url().includes('error') || finalContent.includes("can't be blank")) {
    console.log('\n❌ Registration has errors');
  } else {
    console.log('\nStatus unclear - check screenshot');
  }
  
  await browser.close();
})();
