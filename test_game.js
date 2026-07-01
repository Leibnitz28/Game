const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files'
    ]
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.toString()));

  // Open the file
  await page.goto('file:///C:/Users/HP/.gemini/antigravity/scratch/Game/index.html');
  
  console.log("Page loaded. Clicking Plant button...");
  await page.waitForSelector('#btn-plant');
  await page.click('#btn-plant');
  
  console.log("Waiting for a few seconds to let camera and model start...");
  await new Promise(r => setTimeout(r, 10000));
  
  await browser.close();
})();
