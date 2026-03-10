const axios = require('axios');
const cheerio = require('cheerio');

async function testDealabs() {
  try {
    const { data: html } = await axios.get('https://www.dealabs.com/search?q=lego', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(html);
    const first = $('[data-t="thread"]').first();
    const vueDataStr = first.find('[data-vue3]').attr('data-vue3');
    if(!vueDataStr) return console.log('Dealabs: No vueDataStr');
    const thread = JSON.parse(vueDataStr).props.thread;
    console.log('Dealabs first thread properties:');
    console.log('- title:', thread.title);
    console.log('- mainImage:', thread.mainImage);
    console.log('- threadImage:', thread.threadImage);
    console.log('- image:', thread.image);
    console.log('Keys:', Object.keys(thread).join(', '));
  } catch(e) {
    console.error('Dealabs Error:', e.message);
  }
}

async function testVinted() {
  try {
    const { data: html } = await axios.get('https://www.vinted.fr/vetements?search_text=lego', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36' }
    });
    const $ = cheerio.load(html);
    const first = $('[data-testid^="product-item-id-"]').first();
    console.log('Vinted Href via a tag:', first.find('a').attr('href'));
    const link = first.closest('a').attr('href') || first.find('a').attr('href') || first.attr('href');
    console.log('Vinted Link:', link);
  } catch(e) {
    console.error('Vinted Error:', e.message);
  }
}

testDealabs();
testVinted();
