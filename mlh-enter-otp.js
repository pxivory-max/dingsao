const { chromium } = require('playwright');

const EMAIL = 'xiaowceo2026@deltajohnsons.com';
const OTP = '752151';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  // Go to sign in first  
  console.log('Step 1: Sign in with email...');
  await page.goto('https://my.mlh.io/signup', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  await page.fill('#signin-email', EMAIL);
  
  const submitBtn = await page.$('button[type="submit"]');
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => null),
    submitBtn.click()
  ]);
  await page.waitForTimeout(2000);
  
  const url1 = page.url();
  console.log('URL after email submit:', url1);
  
  if (url1.includes('otp')) {
    console.log('OTP page! Entering code:', OTP);
    
    // Fill each digit
    for (let i = 0; i < 6; i++) {
      await page.fill(`#otp${i}`, OTP[i]);
    }
    await page.waitForTimeout(500);
    
    // Click Continue
    const continueBtn = await page.$('button:has-text("Continue")');
    if (continueBtn) {
      console.log('Clicking Continue...');
      await Promise.all([
        page.waitForNavigation({ timeout: 15000 }).catch(() => null),
        continueBtn.click()
      ]);
    }
    
    await page.waitForTimeout(3000);
    console.log('URL after OTP:', page.url());
    
    const content = await page.evaluate(() => document.body.innerText.substring(0, 5000));
    console.log('Content:', content);
    
    // Check for registration form fields
    const fields = await page.$$eval('input, select, textarea', els => 
      els.map(e => ({ 
        type: e.type, name: e.name, id: e.id, 
        placeholder: e.placeholder, required: e.required,
        tag: e.tagName,
        label: e.labels && e.labels[0] ? e.labels[0].textContent : ''
      }))
    );
    console.log('Fields:', JSON.stringify(fields, null, 2));
    
    await page.screenshot({ path: '/tmp/mlh-profile.png', fullPage: true });
    console.log('Screenshot saved to /tmp/mlh-profile.png');
    
  } else if (url1.includes('wait') || url1.includes('signup')) {
    // Rate limited, try sign in instead
    console.log('Rate limited on signup, trying sign in...');
    await page.goto('https://my.mlh.io/signin', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.fill('#signin-email', EMAIL);
    
    const btn = await page.$('button[type="submit"]');
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      btn.click()
    ]);
    await page.waitForTimeout(2000);
    console.log('URL after signin:', page.url());
    
    if (page.url().includes('otp')) {
      console.log('Need new OTP for signin - check email');
    }
  }
  
  await browser.close();
})();
