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
  
  // Clear mail
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
  
  // Wait for OTP
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
  console.log('Logged in at:', page.url());
  
  // Go to event
  await page.goto('https://events.mlh.io/events/13503-ai-hackfest?intent=register', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await page.waitForTimeout(3000);
  
  // Deep inspection: dump ALL forms and ALL their inputs
  const allForms = await page.evaluate(() => {
    return Array.from(document.forms).map((form, fi) => ({
      index: fi,
      action: form.action,
      method: form.method,
      id: form.id,
      className: form.className,
      inputs: Array.from(form.elements).map(el => ({
        tag: el.tagName,
        type: el.type,
        name: el.name,
        id: el.id,
        value: el.value,
        checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined,
        visible: el.offsetParent !== null || el.type === 'hidden'
      }))
    }));
  });
  
  console.log('ALL FORMS:');
  for (const form of allForms) {
    console.log(`\nForm ${form.index}: action=${form.action} method=${form.method} class=${form.className}`);
    for (const inp of form.inputs) {
      if (inp.type !== 'hidden' || inp.name.includes('accepted') || inp.name.includes('status') || inp.name.includes('region') || inp.name.includes('have_you')) {
        console.log(`  ${inp.tag} type=${inp.type} name="${inp.name}" id="${inp.id}" value="${inp.value}" checked=${inp.checked} visible=${inp.visible}`);
      }
    }
  }
  
  await page.screenshot({ path: '/tmp/mlh-inspect.png', fullPage: true });
  
  await browser.close();
})();
