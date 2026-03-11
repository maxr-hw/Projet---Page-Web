const axios = require('axios');

async function testLegoPrice() {
  try {
    const { data } = await axios.get('https://www.lego.com/fr-fr/product/millennium-falcon-75257', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const m = data.match(/"priceValue":\s*([0-9.]+)/);
    const m2 = data.match(/"amount":\s*([0-9.]+)/);
    const m3 = data.match(/[\d]+[,.][\d]+\s*€/g);
    console.log('priceValue match:', m ? m[1] : 'not found');
    console.log('amount match:', m2 ? m2[1] : 'not found');
    console.log('Euro amounts in page:', m3 ? m3.slice(0,5) : 'none');
  } catch(e) {
    console.error('Error:', e.message);
  }
}

testLegoPrice();
