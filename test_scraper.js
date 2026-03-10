const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  try {
    const { data } = await axios.get('https://www.avenuedelabrique.com/promotions-et-bons-plans-lego', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);
    const elements = $('a[href*="/lego-"]').slice(0, 3);
    elements.each((i, el) => {
      console.log('---ITEM---');
      console.log('href:', $(el).attr('href'));
      console.log('img srcset:', $(el).find('img').attr('srcset') || 'NONE');
      console.log('img src:', $(el).find('img').attr('src') || 'NONE');
      console.log('img data-src:', $(el).find('img').attr('data-src') || 'NONE');
      console.log($(el).html());
    });
  } catch (err) {
    console.error(err);
  }
})();
