const axios = require('axios');

(async () => {
    try {
        const { data } = await axios.get('https://www.dealabs.com/search?q=lego', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        console.log("Dealabs success, HTML length:", data.length);
    } catch(e) {
        console.error("Dealabs fail:", e.message);
    }
    try {
        const { data } = await axios.get('https://www.vinted.fr/vetements?search_text=lego', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        console.log("Vinted success, HTML length:", data.length);
    } catch(e) {
        console.error("Vinted fail:", e.message);
    }
})();
