const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function debugVinted() {
  const { data: html } = await axios.get('https://www.vinted.fr/vetements?search_text=lego', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36' }
  });
  const $ = cheerio.load(html);
  const first = $('[data-testid^="product-item-id-"]').first();
  console.log("Vinted first item inner HTML:");
  console.log(first.html()?.substring(0, 500));
  fs.writeFileSync('vinted_debug.html', first.html() || '');
  console.log("Saved full item HTML to vinted_debug.html");
}

async function debugDealabs() {
  const { data: html } = await axios.get('https://www.dealabs.com/search?q=lego', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36' }
  });
  const $ = cheerio.load(html);
  const first = $('[data-t="thread"]').first();
  console.log("Dealabs first item inner HTML:");
  console.log(first.html()?.substring(0, 1000));
  fs.writeFileSync('dealabs_debug.html', first.html() || '');
  console.log("Saved full item HTML to dealabs_debug.html");
}

debugVinted().catch(console.error);
debugDealabs().catch(console.error);
