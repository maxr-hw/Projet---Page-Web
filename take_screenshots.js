const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, 'public', 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Set viewport
  await page.setViewport({ width: 1280, height: 900 });

  console.log('Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  // Take a screenshot of the hero section
  console.log('Capturing main page screenshot...');
  // Ensure images are loaded
  await page.evaluate(() => {
    return new Promise((resolve) => {
      setTimeout(resolve, 3000);
    });
  });

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'main.png'), fullPage: true });

  // Get the first deal's set number
  const firstDealHref = await page.evaluate(() => {
    const card = document.querySelector('.deal-card a');
    return card ? card.href : null;
  });

  if (firstDealHref) {
    console.log(`Navigating to first deal: ${firstDealHref}`);
    await page.goto(firstDealHref, { waitUntil: 'networkidle0' });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2000)));
    console.log('Capturing set page screenshot...');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'set.png'), fullPage: true });
  }

  await browser.close();
  console.log('Screenshots saved successfully!');
})();
