const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
    let { data } = await axios.get('https://www.dealabs.com/search?q=lego', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36' } });
    let $ = cheerio.load(data);
    let el = $('[data-t="thread"]').first();
    console.log('--- Dealabs Deal HTML ---');
    console.log(el.html().substring(0, 1000));
    console.log('Title:', el.find('[data-t="threadLink"]').text().trim());
    console.log('Href:', el.find('[data-t="threadLink"]').attr('href'));
    console.log('Price:', el.find('.thread-price').text().trim() || el.find('.text--b.text--color-charcoal').text().trim() || 'NOT FOUND');

    let { data: vdata } = await axios.get('https://www.vinted.fr/vetements?search_text=lego', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    $ = cheerio.load(vdata);
    el = $('[data-testid^="grid-item"]').first();
    console.log('\n--- Vinted Deal HTML ---');
    console.log(el.html().substring(0, 800));
})();
