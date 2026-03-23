'use strict';
/**
 * Scraper for Avenue de la Brique
 * Parses deal listings and returns structured deal objects.
 * Uses cheerio for HTML parsing.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./database');

const SOURCES = [
  {
    name: 'Avenue de la Brique',
    url: 'https://www.avenuedelabrique.com/promotions-et-bons-plans-lego',
    scrape: scrapeAvenueDelaBrique,
  },
  {
    name: 'Dealabs',
    url: 'https://www.dealabs.com/search?q=lego',
    scrape: scrapeDealabs,
  },
  {
    name: 'Vinted',
    url: 'https://www.vinted.fr/vetements?search_text=lego',
    scrape: scrapeVinted,
  }
];

async function scrapeAll() {
  console.log('[Scraper] Starting scrape cycle...');
  const allDeals = [];

  for (const source of SOURCES) {
    try {
      const deals = await source.scrape(source);
      console.log(`[Scraper] ✓ ${deals.length} deals from ${source.name}`);
      allDeals.push(...deals);
    } catch (err) {
      console.error(`[Scraper] ✗ Error scraping ${source.name}: ${err.message}`);
    }
  }

  if (allDeals.length > 0) {
    await db.upsertDeals(allDeals);
    console.log(`[Scraper] Saved ${allDeals.length} deals to DB`);
  }

  // Enrich retail prices in the background (non-blocking)
  enrichRetailPrices().catch(e => console.warn('[Scraper] Price enrichment warning:', e.message));

  return allDeals;
}

// ---- Avenue de la Brique ----
async function scrapeAvenueDelaBrique({ name, url }) {
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const $ = cheerio.load(html);
  const deals = [];

  // Convert to array to use for...of
  const items = $('a[href*="/lego-"]').toArray();

  for (const el of items) {
    const $el = $(el);
    const rawHref = $el.attr('href') || '';
    const href = rawHref.startsWith('http') ? rawHref : `https://www.avenuedelabrique.com${rawHref}`;
    const text = $el.text().trim();

    // Extract Image URL
    const imgDataSrc = $el.find('img').attr('data-src');
    let highResImgUrl = '';
    if (imgDataSrc) {
      highResImgUrl = 'https://www.avenuedelabrique.com/img/' + imgDataSrc.replace('/thumbs/', '/').replace(/_\d+x\d+/, '');
    }

    // Extract set number (4-8 digit number inside the text)
    const setMatch = text.match(/\b(\d{4,8})\b/);
    if (!setMatch) continue;
    const rawSetNum = setMatch[1];

    // Extract prices
    const priceMatches = text.match(/([\d,]+(?:\.\d+)?)\s*€/g);
    if (!priceMatches || priceMatches.length < 1) continue;

    const prices = priceMatches.map(p => parseFloat(p.replace(',', '.').replace('€', '').trim()));
    const currentPrice = Math.min(...prices);
    if (currentPrice <= 0 || currentPrice > 5000) continue;

    // Discount
    const discountMatch = text.match(/-(\d+)%/);
    const discountPct = discountMatch ? -parseInt(discountMatch[1]) : null;
    const originalPrice = discountPct && discountPct < 0
      ? Math.round(currentPrice / (1 + discountPct / 100) * 100) / 100
      : null;

    if (discountPct && discountPct >= 0) continue;

    const setNum = rawSetNum.includes('-') ? rawSetNum : `${rawSetNum}-1`;

    const existing = await db.getSet(setNum);
    if (!existing) {
      await db.upsertSet({
        set_num: setNum,
        name: extractName(text, rawSetNum),
        year: null,
        num_parts: null,
        theme_id: null,
        theme_name: guessThemeFromUrl(href),
        franchise: guessThemeFromUrl(href),
        img_url: highResImgUrl,
        description: '',
        piece_url: href,
      });
    } else if (!existing.img_url && highResImgUrl) {
      await db.upsertSet({
        ...existing,
        img_url: highResImgUrl,
        piece_url: existing.piece_url || href
      });
    }

    deals.push({
      set_num: setNum,
      source: name,
      source_url: href,
      price: currentPrice,
      original_price: originalPrice,
      discount_pct: discountPct,
    });
  }

  // Deduplicate
  const map = new Map();
  for (const d of deals) {
    const existing = map.get(d.set_num);
    if (!existing || d.price < existing.price) map.set(d.set_num, d);
  }

  return [...map.values()];
}

// ---- Dealabs ----
async function scrapeDealabs({ name, url }) {
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
    }
  });

  const $ = cheerio.load(html);
  const deals = [];
  const threads = $('[data-t="thread"]').toArray();

  for (const el of threads) {
    try {
      const vueDataStr = $(el).find('[data-vue3]').attr('data-vue3');
      if (!vueDataStr) continue;
      const thread = JSON.parse(vueDataStr).props.thread;

      const title = thread.title || '';
      const setMatch = title.match(/\b(\d{4,8})\b/);
      if (!setMatch) continue;

      const rawSetNum = setMatch[1];
      const setNum = rawSetNum.includes('-') ? rawSetNum : `${rawSetNum}-1`;

      const currentPrice = parseFloat(thread.price);
      if (isNaN(currentPrice) || currentPrice <= 0) continue;

      const originalPrice = thread.nextBestPrice ? parseFloat(thread.nextBestPrice) : null;
      let discountPct = null;
      if (originalPrice && originalPrice > currentPrice) {
        discountPct = -Math.round((1 - (currentPrice / originalPrice)) * 100);
      }

      const sourceUrl = `https://www.dealabs.com/bons-plans/${thread.titleSlug}-${thread.threadId}`;
      const imgEl = $(el).find('img.thread-image');
      const imgUrl = imgEl.attr('src') || '';

      const existing = await db.getSet(setNum);
      if (!existing) {
        await db.upsertSet({
          set_num: setNum,
          name: title,
          year: null,
          num_parts: null,
          theme_id: null,
          theme_name: 'other',
          franchise: 'other',
          img_url: imgUrl,
          description: '',
          piece_url: sourceUrl,
        });
      } else if (!existing.img_url && imgUrl) {
        await db.upsertSet({ ...existing, img_url: imgUrl });
      }

      deals.push({
        set_num: setNum,
        source: name,
        source_url: sourceUrl,
        price: currentPrice,
        original_price: originalPrice,
        discount_pct: discountPct,
      });
    } catch (e) { }
  }

  return deals;
}

// ---- Vinted ----
async function scrapeVinted({ name, url }) {
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
    }
  });

  const $ = cheerio.load(html);
  const deals = [];
  const items = $('[data-testid^="product-item-id-"]').toArray();

  for (const el of items) {
    const $a = $(el).find('a.new-item-box__overlay');
    if ($a.length === 0 && !$(el).is('div.new-item-box__container, div.new-item-box__image-container')) continue;

    const href = $a.attr('href') || $(el).closest('a').attr('href') || $(el).find('a').attr('href') || url;
    const $img = $(el).find('img');
    const altText = $img.attr('alt') || $(el).closest('.new-item-box__container').find('img').attr('alt') || '';

    if (!href.includes('/items/')) continue;

    const setMatch = altText.match(/\b(\d{4,8})\b/);
    if (!setMatch) continue;

    const rawSetNum = setMatch[1];
    const setNum = rawSetNum.includes('-') ? rawSetNum : `${rawSetNum}-1`;

    const priceMatch = altText.match(/([\d,]+)\s*€/);
    if (!priceMatch) continue;
    const currentPrice = parseFloat(priceMatch[1].replace(',', '.'));
    if (isNaN(currentPrice) || currentPrice <= 0) continue;

    const existing = await db.getSet(setNum);
    if (!existing) {
      const itemName = altText.split(',')[0].trim() || `Vinted Set ${setNum}`;
      const detectedFranchise = guessFranchiseFromText(itemName, '') || 'other';
      await db.upsertSet({
        set_num: setNum,
        name: itemName,
        year: null,
        num_parts: null,
        theme_id: null,
        theme_name: detectedFranchise,
        franchise: detectedFranchise,
        img_url: $img.attr('src') || '',
        description: '',
        piece_url: href,
      });
    }

    deals.push({
      set_num: setNum,
      source: name,
      source_url: href,
      price: currentPrice,
      original_price: null,
      discount_pct: null,
    });
  }

  return deals;
}

// ---- Retail Price Enrichment ----

async function enrichRetailPrices() {
  const sets = await db.getSetsNeedingRetailPrice(30);
  if (!sets.length) return;
  console.log(`[Scraper] Enriching retail prices for ${sets.length} sets...`);

  const delay = ms => new Promise(r => setTimeout(r, ms));

  for (const { set_num } of sets) {
    try {
      const { data } = await axios.get(`https://www.brickset.com/sets/${set_num}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const $ = cheerio.load(data);
      let rrp = null;

      $('dl dt').each((_, dt) => {
        if ($(dt).text().trim() === 'RRP') {
          const ddText = $(dt).next('dd').text();
          const eurMatch = ddText.match(/€([\d,]+(?:\.?\d+)?)/);
          if (eurMatch) rrp = parseFloat(eurMatch[1].replace(',', '.'));
        }
      });

      if (rrp) {
        await db.upsertRetailPrice(set_num, rrp);
        console.log(`[Scraper] ✓ RRP for ${set_num}: €${rrp}`);
      }

      await delay(800);
    } catch(e) { }
  }
}

// ---- Helpers ----

function extractName(text, setNum) {
  const lines = text.split(/[\n\t]+/).map(l => l.trim()).filter(Boolean);
  const nameCandidate = lines.find(l => !l.match(/^[\d.]+\s*€?$/) && !l.match(/^-?\d+%$/) && l !== setNum);
  return nameCandidate || `LEGO Set ${setNum}`;
}

function guessThemeFromUrl(url) {
  const match = url.match(/\/lego-([^/]+)\//);
  if (!match) return 'other';
  const slug = match[1].replace(/-/g, ' ');
  return guessFranchiseFromText(slug, '') || slug.split(' ')[0];
}

function guessFranchiseFromText(name, theme) {
  const text = `${name || ''} ${theme || ''}`.toLowerCase();
  const KEYWORDS = [
    ['star wars', 'star-wars'],
    ['harry potter', 'harry-potter'],
    ['fantastic beasts', 'harry-potter'],
    ['hogwarts', 'harry-potter'],
    ['hermione', 'harry-potter'],
    ['marvel', 'marvel'],
    ['avengers', 'marvel'],
    ['iron man', 'marvel'],
    ['spider.man', 'marvel'],
    ['spiderman', 'marvel'],
    ['captain america', 'marvel'],
    ['guardians of the galaxy', 'marvel'],
    ['x-men', 'marvel'],
    ['black panther', 'marvel'],
    ['thor', 'marvel'],
    ['dc ', 'dc'],
    ['batman', 'dc'],
    ['superman', 'dc'],
    ['wonder woman', 'dc'],
    ['justice league', 'dc'],
    ['the flash', 'dc'],
    ['indiana jones', 'indiana-jones'],
    ['indy', 'indiana-jones'],
    ['one piece', 'one-piece'],
    ['fortnite', 'fortnite'],
    ['minecraft', 'minecraft'],
    ['pokemon', 'pokemon'],
    ['overwatch', 'overwatch'],
    ['stranger things', 'stranger-things'],
    ['home alone', 'icons'],
    ['seinfeld', 'icons'],
    ['friends', 'friends'],
    ['disney', 'disney'],
    ['mickey', 'disney'],
    ['frozen', 'disney'],
    ['ariel', 'disney'],
    ['moana', 'disney'],
    ['mulan', 'disney'],
    ['rapunzel', 'disney'],
    ['belle', 'disney'],
    ['cinderella', 'disney'],
    ['encanto', 'disney'],
    ['coco', 'disney'],
    ['playlist', 'disney'],
    ['arendelle', 'disney'],
    ['maleficent', 'disney'],
    ['elsa', 'disney'],
    ['pixar', 'disney'],
    ['toy story', 'disney'],
    ['buzz lightyear', 'disney'],
    ['lightyear', 'disney'],
    ['nemo', 'disney'],
    ['incredibles', 'disney'],
    ['carsworld', 'disney'],
    ['the lion king', 'disney'],
    ['peter pan', 'disney'],
    ['alice in wonderland', 'disney'],
    ['sleeping beauty', 'disney'],
    ['snow white', 'disney'],
    ['little mermaid', 'disney'],
    ['petite siren', 'disney'],
    ['technic', 'technic'],
    ['ninjago', 'ninjago'],
    ['city', 'city'],
    ['creator', 'creator'],
    ['classic', 'classic'],
    ['ideas', 'ideas'],
    ['icons', 'icons'],
    ['art', 'art'],
    ['botanical', 'botanicals'],
    ['botanicals', 'botanicals'],
    ['orchid', 'botanicals'],
    ['bouquet', 'botanicals'],
    ['tulip', 'botanicals'],
    ['bonsai', 'botanicals'],
    ['flower', 'botanicals'],
    ['architecture', 'architecture'],
    ['duplo', 'duplo'],
    ['super mario', 'super-mario'],
    ['mario kart', 'super-mario'],
    ['luigi', 'super-mario'],
    ['piranha', 'super-mario'],
    ['speed champions', 'speed-champions'],
    ['formula 1', 'speed-champions'],
    ['formula1', 'speed-champions'],
    ['f1', 'speed-champions'],
    ['ferrari', 'speed-champions'],
    ['bugatti', 'speed-champions'],
    ['mclaren', 'speed-champions'],
    ['lamborghini', 'speed-champions'],
    ['porsche', 'speed-champions'],
    ['friends liann', 'friends'],
    ['friends aliya', 'friends'],
    ['friends autumn', 'friends'],
    ['friends nova', 'friends'],
    ['vidiyo', 'vidiyo'],
    ['movie', 'movie'],
    ['lego movie', 'movie'],
    ['emmet', 'movie'],
    ['batman movie', 'movie'],
    ['jurassic', 'jurassic-world'],
    ['jurassic world', 'jurassic-world'],
    ['jurassic park', 'jurassic-world'],
    ['dreamzzz', 'dreamzzz'],
    ['monkie kid', 'monkie-kid'],
    ['nexo knights', 'nexo-knights'],
    ['chima', 'chima'],
    ['bionicle', 'bionicle'],
    ['dots', 'dots'],
    ['hidden side', 'hidden-side'],
    ['trolls', 'trolls'],
    ['elves', 'elves'],
    ['the lord of the rings', 'icons'],
    ['seigneur des anneaux', 'icons'],
    ['hobbit', 'icons'],
    ['gondor', 'icons'],
    ['barad', 'icons'],
    ['lotr', 'icons'],
    ['nasa', 'icons'],
    ['artemis', 'icons'],
    ['transformers', 'icons'],
    ['bumblebee', 'icons'],
    ['fast and furious', 'icons'],
    ['fast furious', 'icons'],
    ['notre.dame', 'icons'],
    ['eiffel', 'icons'],
    ['colosseum', 'icons'],
    ['big ben', 'icons'],
    ['le jardin', 'icons'],
    ['chrysanth', 'botanicals'],
    ['magnolia', 'botanicals'],
    ['cerisiers', 'botanicals'],
  ];

  for (const [kw, franchise] of KEYWORDS) {
    const re = new RegExp(kw, 'i');
    if (re.test(text)) return franchise;
  }
  return null;
}

module.exports = { scrapeAll, guessFranchiseFromText };
