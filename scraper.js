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
    db.upsertDeals(allDeals);
    console.log(`[Scraper] Saved ${allDeals.length} deals to DB`);
  }

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

  // Avenue de la Brique product listings – adapt selectors as needed
  // They list items with set numbers, current price, and discount badge
  $('a[href*="/lego-"]').each((_, el) => {
    const $el = $(el);
    const rawHref = $el.attr('href') || '';
    const href = rawHref.startsWith('http') ? rawHref : `https://www.avenuedelabrique.com${rawHref}`;
    const text = $el.text().trim();

    // Extract Image URL
    const imgDataSrc = $el.find('img').attr('data-src');
    let highResImgUrl = '';
    if (imgDataSrc) {
      // transform: produits/123/thumbs/name_0x180.jpg -> https://www.avenuedelabrique.com/img/produits/123/name.jpg
      highResImgUrl = 'https://www.avenuedelabrique.com/img/' + imgDataSrc.replace('/thumbs/', '/').replace(/_\d+x\d+/, '');
    }

    // Extract set number (4-8 digit number inside the text)
    const setMatch = text.match(/\b(\d{4,8})\b/);
    if (!setMatch) return;
    const rawSetNum = setMatch[1];

    // Extract prices from text blocks
    const priceMatches = text.match(/([\d,]+(?:\.\d+)?)\s*€/g);
    if (!priceMatches || priceMatches.length < 1) return;

    const prices = priceMatches.map(p => parseFloat(p.replace(',', '.').replace('€', '').trim()));
    const currentPrice = Math.min(...prices);
    if (currentPrice <= 0 || currentPrice > 5000) return;

    // Look for discount badge
    const discountMatch = text.match(/-(\d+)%/);
    const discountPct = discountMatch ? -parseInt(discountMatch[1]) : null;
    const originalPrice = discountPct && discountPct < 0
      ? Math.round(currentPrice / (1 + discountPct / 100) * 100) / 100
      : null;

    if (discountPct && discountPct >= 0) return; // skip non-deals

    // Normalize set number (add -1 suffix if needed)
    const setNum = rawSetNum.includes('-') ? rawSetNum : `${rawSetNum}-1`;

    // Ensure the set is in DB (seed minimal record if not)
    const existing = db.getSet(setNum);
    if (!existing) {
      db.upsertSet({
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
      db.upsertSet({
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
  });

  // Deduplicate by set_num, keep lowest price
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

  $('[data-t="thread"]').each((_, el) => {
    try {
      const vueDataStr = $(el).find('[data-vue3]').attr('data-vue3');
      if (!vueDataStr) return;
      const thread = JSON.parse(vueDataStr).props.thread;

      const title = thread.title || '';
      const setMatch = title.match(/\b(\d{4,8})\b/);
      if (!setMatch) return;

      const rawSetNum = setMatch[1];
      const setNum = rawSetNum.includes('-') ? rawSetNum : `${rawSetNum}-1`;

      const currentPrice = parseFloat(thread.price);
      if (isNaN(currentPrice) || currentPrice <= 0) return;

      const originalPrice = thread.nextBestPrice ? parseFloat(thread.nextBestPrice) : null;
      let discountPct = null;
      if (originalPrice && originalPrice > currentPrice) {
        discountPct = -Math.round((1 - (currentPrice / originalPrice)) * 100);
      }

      const sourceUrl = `https://www.dealabs.com/bons-plans/${thread.titleSlug}-${thread.threadId}`;

      // Ensure the set is in DB
      const existing = db.getSet(setNum);
      if (!existing) {
        db.upsertSet({
          set_num: setNum,
          name: title,
          year: null,
          num_parts: null,
          theme_id: null,
          theme_name: 'other',
          franchise: 'other',
          img_url: '',
          description: '',
          piece_url: sourceUrl,
        });
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
  });

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

  $('[data-testid^="product-item-id-"]').each((_, el) => {
    // Vinted nests the same test-id on the wrapper and the image!
    // We only want to process the wrapper that actually contains the root a-tag.
    const $a = $(el).find('a.new-item-box__overlay');

    // Skip internal elements that don't directly wrap the main link
    if ($a.length === 0 && !$(el).is('div.new-item-box__container, div.new-item-box__image-container')) return;

    // Try to get the specific piece URL or fallback to the wrapper href
    const href = $a.attr('href') || $(el).closest('a').attr('href') || $(el).find('a').attr('href') || url;

    const $img = $(el).find('img');
    const altText = $img.attr('alt') || $(el).closest('.new-item-box__container').find('img').attr('alt') || '';

    if (!href.includes('/items/')) return; // Ignore if it's inherently a bad link

    // Find set number in alt text
    const setMatch = altText.match(/\b(\d{4,8})\b/);
    if (!setMatch) return;

    const rawSetNum = setMatch[1];
    const setNum = rawSetNum.includes('-') ? rawSetNum : `${rawSetNum}-1`;

    // Find price in alt text (e.g. 3,00 €)
    const priceMatch = altText.match(/([\d,]+)\s*€/);
    if (!priceMatch) return;
    const currentPrice = parseFloat(priceMatch[1].replace(',', '.'));
    if (isNaN(currentPrice) || currentPrice <= 0) return;

    // Ensure the set is in DB
    const existing = db.getSet(setNum);
    if (!existing) {
      db.upsertSet({
        set_num: setNum,
        name: altText.split(',')[0].trim() || `Vinted Set ${setNum}`,
        year: null,
        num_parts: null,
        theme_id: null,
        theme_name: 'other',
        franchise: 'other',
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
  });

  return deals;
}

// ---- Helpers ----

function extractName(text, setNum) {
  // Text is usually: "Set Name\n\tSETNUM\n\tPRICE €\n\t-XX%"
  const lines = text.split(/[\n\t]+/).map(l => l.trim()).filter(Boolean);
  const nameCandidate = lines.find(l => !l.match(/^[\d.]+\s*€?$/) && !l.match(/^-?\d+%$/) && l !== setNum);
  return nameCandidate || `LEGO Set ${setNum}`;
}

function guessThemeFromUrl(url) {
  const match = url.match(/\/lego-([^/]+)\//);
  if (!match) return 'other';
  const slug = match[1];
  const map = {
    'star-wars': 'star-wars',
    'harry-potter': 'harry-potter',
    'technic': 'technic',
    'city': 'city',
    'creator': 'creator',
    'ideas': 'ideas',
    'marvel': 'marvel',
    'dc-comics': 'dc',
    'ninjago': 'ninjago',
    'minecraft': 'minecraft',
    'pokemon': 'pokemon',
    'indiana-jones': 'indiana-jones',
    'speed-champions': 'speed-champions',
    'architecture': 'architecture',
    'icons': 'icons',
    'disney': 'disney',
  };
  for (const [key, val] of Object.entries(map)) {
    if (slug.includes(key)) return val;
  }
  return slug;
}

module.exports = { scrapeAll };
