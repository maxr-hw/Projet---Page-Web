const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
    try {
        let { data } = await axios.get('https://www.dealabs.com/search?q=lego', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        let $ = cheerio.load(data);
        let dealsFound = 0;
        $('[data-t="thread"]').slice(0, 3).each((_, el) => {
            try {
                const vueDataStr = $(el).find('[data-vue3]').attr('data-vue3');
                if (vueDataStr) {
                    const vueData = JSON.parse(vueDataStr);
                    const thread = vueData.props.thread;
                    console.log(`D Deal ${++dealsFound}: ${thread.title} | ${thread.price}€ | URL: https://www.dealabs.com/bons-plans/${thread.titleSlug}-${thread.threadId}`);
                }
            } catch(e) {}
        });
    } catch(e) {}

    try {
        let { data: vdata } = await axios.get('https://www.vinted.fr/vetements?search_text=lego', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        let $ = cheerio.load(vdata);
        $('script').each((i, el) => {
            const html = $(el).html() || '';
            if (html.includes('"items"')) {
                try {
                    const match = html.match(/"items":(\[.*?\]),"page"/);
                    if (match) {
                        const items = JSON.parse(match[1]);
                        console.log(`V Deal 1: ${items[0].title} | ${items[0].price} | URL: ${items[0].url}`);
                    }
                } catch(e) {}
            }
        });
    } catch(e) {}
})();
