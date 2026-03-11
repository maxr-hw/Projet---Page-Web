const axios = require('axios');
const cheerio = require('cheerio');

async function testBricksetPrice(setNum) {
  try {
    const baseNum = setNum.replace(/-1$/, '');
    const { data } = await axios.get(`https://www.brickset.com/sets/${setNum}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(data);
    // Brickset shows RRP in the details section
    const prices = [];
    $('dl > dt').each((_, dt) => {
      if ($(dt).text().trim().toLowerCase().includes('eur') || $(dt).text().trim().toLowerCase().includes('retail')) {
        prices.push($(dt).next('dd').text().trim());
      }
    });
    const allDt = $('dl dt').map((_, e) => $(e).text().trim()).get();
    const allDd = $('dl dd').map((_, e) => $(e).text().trim()).get();
    console.log('DTs:', allDt.join(' | '));
    console.log('DDs:', allDd.join(' | '));
    console.log('EUR prices:', prices);
  } catch(e) {
    console.error('Error:', e.message, e.response?.status);
  }
}

testBricksetPrice('75257-1');
