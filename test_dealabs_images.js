const axios = require('axios');
const cheerio = require('cheerio');

async function testDealabs() {
  const url = 'https://www.dealabs.com/search?q=lego';
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
    }
  });

  const $ = cheerio.load(html);
  
  for (const el of $('[data-t="thread"]').get()) {
    try {
      const vueDataStr = $(el).find('[data-vue3]').attr('data-vue3');
      if (!vueDataStr) continue;
      const thread = JSON.parse(vueDataStr).props.thread;
      
      console.log('--- Thread Found ---');
      console.log('Title:', thread.title);
      console.log('MainImage structure:', JSON.stringify(thread.mainImage, null, 2));
      
      // Try to construct URL
      if (thread.mainImage) {
        const { path, name, ext } = thread.mainImage;
        const imgUrl = `https://static-pepper.dealabs.com/${path}/${name}.jpg`;
        console.log('Constructed URL:', imgUrl);
      }
      
      const imgEl = $(el).find('img.thread-image');
      console.log('DOM img.thread-image src:', imgEl.attr('src'));
      
      break; // Only test first one
    } catch (e) { 
      console.error('Error parsing vueData:', e.message);
    }
  }
}

testDealabs();
