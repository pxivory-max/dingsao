const mailboxPassword = require('./mail-config').password;
const { chromium } = require('playwright');

const EMAIL = 'xiaowceo2026@deltajohnsons.com';
const EMAIL_PASSWORD = mailboxPassword;

async function getMailToken(page) {
  const resp = await page.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return await r.json();
  }, { email: EMAIL, password: EMAIL_PASSWORD });
  return resp.token;
}

async function waitForOTP(page, token, maxWait = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const messages = await page.evaluate(async (t) => {
      const r = await fetch('https://api.mail.tm/messages', {
        headers: { 'Authorization': 'Bearer ' + t }
      });
      return await r.json();
    }, token);
    
    const items = messages['hydra:member'] || [];
    if (items.length > 0) {
      // Get the latest message
      const msgId = items[0].id;
      const msg = await page.evaluate(async (data) => {
        const r = await fetch('https://api.mail.tm/messages/' + data.id, {
          headers: { 'Authorization': 'Bearer ' + data.token }
        });
        return await r.json();
      }, { id: msgId, token });
      
      const text = msg.text || msg.html || '';
      console.log('Email subject:', msg.subject);
      console.log('Email text (first 500):', text.substring(0, 500));
      
      // Extract 6-digit OTP code
      const otpMatch = text.match(/\b(\d{6})\b/);
      if (otpMatch) return otpMatch[1];
      
      // Try extracting from subject
      const subjMatch = (msg.subject || '').match(/\b(\d{6})\b/);
      if (subjMatch) return subjMatch[1];
      
      // Sometimes the code is in a specific format
      const codeMatch = text.match(/code[:\s]+(\d{6})/i) || text.match(/(\d{6})/);
      if (codeMatch) return codeMatch[1];
    }
    
    console.log('Waiting for email... (' + Math.round((Date.now() - start) / 1000) + 's)');
    await page.waitForTimeout(3000);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  // Get mail token
  console.log('Getting mail token...');
  const mailToken = await getMailToken(page);
  console.log('Mail token obtained:', !!mailToken);
  
  // Navigate to MLH signup
  console.log('Going to MLH signup...');
  await page.goto('https://my.mlh.io/signup', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  // Fill email and submit
  await page.fill('#signin-email', EMAIL);
  const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Sign Up")');
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    submitBtn.click()
  ]);
  await page.waitForTimeout(2000);
  
  console.log('URL after submit:', page.url());
  
  // Check if we're on OTP page
  if (page.url().includes('otp')) {
    console.log('OTP page detected, waiting for email...');
    
    const otp = await waitForOTP(page, mailToken, 45000);
    
    if (otp) {
      console.log('OTP code found:', otp);
      
      // Fill each digit
      for (let i = 0; i < 6; i++) {
        await page.fill(`#otp${i}`, otp[i]);
      }
      
      // Click Continue
      const continueBtn = await page.$('button:has-text("Continue")');
      if (continueBtn) {
        await Promise.all([
          page.waitForNavigation({ timeout: 15000 }).catch(() => null),
          continueBtn.click()
        ]);
      }
      
      await page.waitForTimeout(3000);
      console.log('URL after OTP:', page.url());
      
      const content = await page.evaluate(() => document.body.innerText.substring(0, 3000));
      console.log('Page content:', content);
      
      const fields = await page.$$eval('input, select, textarea', els => 
        els.map(e => ({ 
          type: e.type, name: e.name, id: e.id, 
          placeholder: e.placeholder, required: e.required,
          tag: e.tagName
        }))
      );
      console.log('Fields:', JSON.stringify(fields, null, 2));
      
      await page.screenshot({ path: '/tmp/mlh-after-otp.png', fullPage: true });
    } else {
      console.log('Failed to get OTP code from email');
      
      // Check email inbox
      const msgs = await page.evaluate(async (t) => {
        const r = await fetch('https://api.mail.tm/messages', {
          headers: { 'Authorization': 'Bearer ' + t }
        });
        return await r.json();
      }, mailToken);
      console.log('Inbox:', JSON.stringify(msgs, null, 2).substring(0, 1000));
    }
  } else {
    console.log('Not on OTP page, checking current state...');
    const content = await page.evaluate(() => document.body.innerText.substring(0, 2000));
    console.log('Content:', content);
  }
  
  await page.screenshot({ path: '/tmp/mlh-final.png', fullPage: true });
  console.log('Done');
  
  await browser.close();
})();
