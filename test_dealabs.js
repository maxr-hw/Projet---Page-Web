const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
    try {
        const { data } = await axios.get('https://www.dealabs.com/search?q=lego', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        const $ = cheerio.load(data);
        console.log("Dealabs title:", $('title').text());
        
        let dealsFound = 0;
        // Dealabs usually uses classes like threadGrid, thread-title, thread-price
        $('[data-t="thread"]').slice(0, 3).each((_, el) => {
            dealsFound++;
            const title = $(el).find('[data-t="threadLink"]').text().trim() || $(el).find('.thread-title').text().trim();
            const price = $(el).find('.thread-price').text().trim();
            console.log(`Deal ${dealsFound}: ${title} - ${price}`);
        });

        if (dealsFound === 0) {
            // fallback generic link search
            $('a[href*="/bons-plans/"]').slice(0,3).each((_, el) => {
                console.log($(el).text().trim().substring(0, 100));
            });
        }
    } catch(e) {
        console.error("Dealabs fail:", e.message);
    }
})();
