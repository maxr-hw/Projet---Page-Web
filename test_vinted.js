const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
    try {
        const { data } = await axios.get('https://www.vinted.fr/vetements?search_text=lego', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        const $ = cheerio.load(data);
        console.log("Vinted title:", $('title').text());
        
        let found = false;
        $('script').each((i, el) => {
            const html = $(el).html() || '';
            if (html.includes('"items"')) {
                // Try to parse out the JSON
                try {
                    const match = html.match(/"items":(\[.*?\]),"page"/);
                    if (match) {
                        const items = JSON.parse(match[1]);
                        console.log("Found Vinted items:", items.length);
                        console.log("First item:", items[0].title, "-", items[0].price);
                        found = true;
                    }
                } catch(e) {}
            }
        });
        
        if (!found) {
            console.log("Trying data-testid items:");
            $('[data-testid^="grid-item"]').slice(0, 3).each((i, el) => {
                console.log($(el).text().trim().substring(0, 50));
            });
        }
    } catch(e) {
        console.error("Vinted fail:", e.message);
    }
})();
