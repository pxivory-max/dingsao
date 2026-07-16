const { chromium } = require('playwright');

const EMAIL = 'xiaowceo2026@deltajohnsons.com';
const EMAIL_PASSWORD = 'Hackfest2026Pass!';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Get token
  const tokenResp = await page.evaluate(async (data) => {
    const r = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: data.email, password: data.password })
    });
    return await r.json();
  }, { email: EMAIL, password: EMAIL_PASSWORD });
  
  const token = tokenResp.token;
  console.log('Token obtained:', !!token);
  
  // Check messages
  const messages = await page.evaluate(async (t) => {
    const r = await fetch('https://api.mail.tm/messages', {
      headers: { 'Authorization': 'Bearer ' + t }
    });
    return await r.json();
  }, token);
  
  const items = messages['hydra:member'] || [];
  console.log('Messages count:', items.length);
  
  for (const item of items) {
    console.log('Subject:', item.subject, 'From:', JSON.stringify(item.from));
    
    // Get full message
    const msg = await page.evaluate(async (data) => {
      const r = await fetch('https://api.mail.tm/messages/' + data.id, {
        headers: { 'Authorization': 'Bearer ' + data.token }
      });
      return await r.json();
    }, { id: item.id, token });
    
    console.log('Text:', (msg.text || '').substring(0, 500));
    console.log('---');
  }
  
  if (items.length === 0) {
    console.log('No emails yet. Waiting 30s...');
    await page.waitForTimeout(30000);
    
    const messages2 = await page.evaluate(async (t) => {
      const r = await fetch('https://api.mail.tm/messages', {
        headers: { 'Authorization': 'Bearer ' + t }
      });
      return await r.json();
    }, token);
    
    const items2 = messages2['hydra:member'] || [];
    console.log('Messages count after wait:', items2.length);
    for (const item of items2) {
      console.log('Subject:', item.subject);
      const msg = await page.evaluate(async (data) => {
        const r = await fetch('https://api.mail.tm/messages/' + data.id, {
          headers: { 'Authorization': 'Bearer ' + data.token }
        });
        return await r.json();
      }, { id: item.id, token });
      console.log('Text:', (msg.text || '').substring(0, 500));
    }
  }
  
  await browser.close();
})();
