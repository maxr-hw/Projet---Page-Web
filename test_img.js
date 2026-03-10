const axios = require('axios');

(async () => {
  const thumbUrl = 'https://www.avenuedelabrique.com/img/produits/43103/thumbs/43103-punk-pirate-beatbox-1-1613506980_0x180.jpg';
  const fullUrl = 'https://www.avenuedelabrique.com/img/produits/43103/43103-punk-pirate-beatbox-1-1613506980.jpg';

  try {
    const res1 = await axios.head(thumbUrl);
    console.log('Thumb OK:', res1.status);
  } catch(e) { console.log('Thumb FAIL:', e.message); }

  try {
    const res2 = await axios.head(fullUrl);
    console.log('Full OK:', res2.status);
  } catch(e) { console.log('Full FAIL:', e.message); }
})();
