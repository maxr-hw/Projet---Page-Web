'use strict';
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const db        = require('./database');
const catalog   = require('./catalog');
const scraper   = require('./scraper');
const scheduler = require('./scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FRANCHISE_META = {
  // Licensed / Movies / Games
  'star-wars':      { label: 'Star Wars',          icon: 'rocket_launch', color: '#2C3E50' },
  'harry-potter':   { label: 'Harry Potter',       icon: 'electric_bolt', color: '#8E44AD' },
  'marvel':         { label: 'Marvel',             icon: 'shield',        color: '#C0392B' },
  'dc':             { label: 'DC',                 icon: 'dark_mode',     color: '#2980B9' },
  'lotr':           { label: 'Lord of the Rings',  icon: 'auto_awesome',  color: '#D4AC0D' },
  'indiana-jones':  { label: 'Indiana Jones',      icon: 'map',           color: '#A0522D' },
  'jurassic':       { label: 'Jurassic World',     icon: 'pets',          color: '#1E8449' },
  'minecraft':      { label: 'Minecraft',          icon: 'grid_view',     color: '#27AE60' },
  'disney':         { label: 'Disney',             icon: 'castle',        color: '#2E86C1' },
  'mario':          { label: 'Super Mario',        icon: 'sports_esports', color: '#E74C3C' },
  'sonic':          { label: 'Sonic',              icon: 'bolt',          color: '#2980B9' },
  'animal-crossing':{ label: 'Animal Crossing',    icon: 'park',          color: '#229954' },
  'avatar':         { label: 'Avatar',             icon: 'waves',         color: '#3498DB' },
  'stranger-things':{ label: 'Stranger Things',    icon: 'flashlight_on', color: '#922B21' },
  'overwatch':      { label: 'Overwatch',          icon: 'security',      color: '#F39C12' },
  'simpsons':       { label: 'The Simpsons',       icon: 'face',          color: '#F4D03F' },
  'scooby-doo':     { label: 'Scooby-Doo',         icon: 'search',        color: '#1ABC9C' },
  'ghostbusters':   { label: 'Ghostbusters',       icon: 'emergency',     color: '#7F8C8D' },
  'bttf':           { label: 'Back to the Future', icon: 'schedule',      color: '#D35400' },
  'muppets':        { label: 'The Muppets',        icon: 'theaters',      color: '#2ECC71' },
  'looney-tunes':   { label: 'Looney Tunes',       icon: 'animation',     color: '#E67E22' },
  'spongebob':      { label: 'SpongeBob',          icon: 'water',         color: '#F7DC6F' },
  'toy-story':      { label: 'Toy Story',          icon: 'toys',          color: '#3498DB' },
  'cars':           { label: 'Cars',               icon: 'directions_car', color: '#C0392B' },
  'potc':           { label: 'Pirates Caribbean',  icon: 'sailing',       color: '#1F618D' },
  'transformers':   { label: 'Transformers',       icon: 'smart_toy',     color: '#5D6D7E' },
  'horizon':        { label: 'Horizon',            icon: 'adjust',        color: '#2E4053' },
  'fortnite':       { label: 'Fortnite',           icon: 'architecture',  color: '#8E44AD' },
  'wicked':         { label: 'Wicked',             icon: 'auto_fix_high', color: '#1D8348' },
  'wednesday':      { label: 'Wednesday',          icon: 'nights_stay',   color: '#17202A' },
  'minions':        { label: 'Minions',            icon: 'face',          color: '#F1C40F' },
  'gabbys-dollhouse': { label: "Gabby's Dollhouse", icon: 'home',          color: '#FF85A2' },
  'trolls':         { label: 'Trolls',             icon: 'celebration',   color: '#F368E0' },
  'angry-birds':    { label: 'Angry Birds',        icon: 'flutter_dash',  color: '#E74C3C' },
  'pokemon':        { label: 'Pokémon',            icon: 'catching_pokemon', color: '#FFCC00' },

  // Original / LEGO IP
  'technic':        { label: 'Technic',            icon: 'settings',      color: '#E07B39' },
  'city':           { label: 'City',               icon: 'location_city', color: '#5BA85C' },
  'ninjago':        { label: 'Ninjago',            icon: 'swords',        color: '#C0392B' },
  'dreamzzz':       { label: 'Dreamzzz',           icon: 'bedtime',       color: '#9B59B6' },
  'monkie-kid':     { label: 'Monkie Kid',         icon: 'cloud',         color: '#E67E22' },
  'friends':        { label: 'Friends',            icon: 'people',        color: '#D291BC' },
  'architecture':   { label: 'Architecture',       icon: 'home_work',     color: '#95A5A6' },
  'icons':          { label: 'Icons',              icon: 'diamond',       color: '#E8922A' },
  'ideas':          { label: 'Ideas',              icon: 'lightbulb',     color: '#C97C3A' },
  'creator':        { label: 'Creator',            icon: 'brush',         color: '#D4A030' },
  'speed-champions':{ label: 'Speed Champions',    icon: 'speed',         color: '#E74C3C' },
  'classic':        { label: 'Classic',            icon: 'extension',     color: '#2E86C1' },
  'duplo':          { label: 'Duplo',              icon: 'child_care',    color: '#E91E63' },
  'brickheadz':     { label: 'BrickHeadz',         icon: 'portrait',      color: '#5D6D7E' },
  'art':            { label: 'Art',                icon: 'palette',       color: '#212121' },
  'botanicals':     { label: 'Botanicals',         icon: 'grass',         color: '#27AE60' },
  'hidden-side':    { label: 'Hidden Side',        icon: 'visibility_off', color: '#6200EA' },
  'vidiyo':         { label: 'Vidiyo',             icon: 'music_note',    color: '#FF4081' },
  'bionicle':       { label: 'Bionicle',           icon: 'masks',         color: '#16A085' },
  'hero-factory':   { label: 'Hero Factory',       icon: 'build',         color: '#2980B9' },
  'castle':         { label: 'Castle',             icon: 'fort',          color: '#7F8C8D' },
  'pirates':        { label: 'Pirates',            icon: 'flag',          color: '#2C3E50' },
  'space':          { label: 'Space',              icon: 'public',        color: '#1A237E' },
  'western':        { label: 'Western',            icon: 'terrain',       color: '#A0522D' },
  'vikings':        { label: 'Vikings',            icon: 'rowing',        color: '#2E4053' },
  'adventurers':    { label: 'Adventurers',        icon: 'explore',       color: '#D4AC0D' },
  'power-miners':   { label: 'Power Miners',       icon: 'construction',  color: '#F39C12' },
  'rock-raiders':   { label: 'Rock Raiders',       icon: 'terrain',       color: '#424242' },
  'monster-fighters':{ label: 'Monster Fighters',   icon: 'skull',         color: '#4A148C' },
  'pharaohs-quest': { label: "Pharaoh's Quest",    icon: 'temple_hindu',  color: '#FBC02D' },
  'dino':           { label: 'Dino',               icon: 'pets',          color: '#1B5E20' },
  'unikitty':       { label: 'Unikitty',           icon: 'auto_awesome',  color: '#FF80AB' },
  'lego-movie':     { label: 'LEGO Movie',         icon: 'videocam',      color: '#FFD600' },
  'other':          { label: 'Other',              icon: 'toys',          color: '#7F8C8D' },
};

// ---- API Routes ----

// GET /api/deals – paginated + filtered deal list
app.get('/api/deals', (req, res) => {
  try {
    const { franchise, sort, page, limit, q } = req.query;
    const items = db.getDeals({
      franchise: franchise || 'all',
      sort: sort || 'deal',
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 24,
      q: q || ''
    });
    res.json({ ok: true, data: items });
  } catch (err) {
    console.error('[API /deals]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/spotlight – best deals (too good to be true)
app.get('/api/spotlight', (req, res) => {
  try {
    const deals = db.getSpotlightDeals(6);
    res.json({ ok: true, data: deals });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sets/:setNum – full detail for one set
app.get('/api/sets/:setNum', async (req, res) => {
  try {
    const setNum = req.params.setNum;
    let detail   = db.getDealDetail(setNum);

    if (!detail) {
      // Return 404 immediately since catalog sync handles all ~25k sets offline now.
    }

    if (!detail) return res.status(404).json({ ok: false, error: 'Set not found' });

    // Enrich with franchise metadata
    const meta = FRANCHISE_META[detail.franchise] || FRANCHISE_META['other'];
    res.json({ ok: true, data: { ...detail, ...meta } });
  } catch (err) {
    console.error('[API /sets/:setNum]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/franchises – franchise summary list
app.get('/api/franchises', (req, res) => {
  try {
    const rows = db.getFranchises();
    const enriched = rows.map(r => ({
      ...r,
      ...(FRANCHISE_META[r.franchise] || FRANCHISE_META['other']),
    }));
    res.json({ ok: true, data: enriched });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/search?q=...
app.get('/api/search', (req, res) => {
  try {
    const q = req.query.q || '';
    if (q.length < 2) return res.json({ ok: true, data: [] });
    const results = db.searchSets(q);
    res.json({ ok: true, data: results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  try {
    res.json({ ok: true, data: db.getStats() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/vote/:setNum { direction: 'up'|'down' }
app.post('/api/vote/:setNum', (req, res) => {
  try {
    const { direction } = req.body;
    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({ ok: false, error: 'direction must be up or down' });
    }
    const result = db.vote(req.params.setNum, direction);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/refresh – manually trigger a scrape + optional rebrickable seed in background
app.get('/api/refresh', (req, res) => {
  try {
    console.log('[API] Background refresh triggered');
    // Run scrape + sync catalog
    (async () => {
      try {
        await scraper.scrapeAll();
        await catalog.syncCatalog();
      } catch (e) {
        console.error('[Refresh BG]', e.message);
      }
    })();
    res.json({ ok: true, message: 'Refresh started in background' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/scrape – RUN the scraper and return the results directly
app.get('/api/scrape', async (req, res) => {
  try {
    console.log('[API] Live scrape requested');
    const deals = await scraper.scrapeAll();
    res.json({ ok: true, count: deals.length, data: deals });
  } catch (err) {
    console.error('[API /scrape]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/franchise-meta – all franchise metadata for frontend
app.get('/api/franchise-meta', (req, res) => {
  res.json({ ok: true, data: FRANCHISE_META });
});

// Catch-all: serve index.html (SPA)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Startup ----
async function startup() {
  // Init DB schema
  db.getDb();

  // Start server first
  app.listen(PORT, () => {
    console.log(`\n🧱 Lego Market running on → http://localhost:${PORT}`);
    console.log(`   Press Ctrl+C to stop\n`);
  });

  // Then run initial data seed (non-blocking)
  setImmediate(async () => {
    try {
      console.log('[Startup] Syncing catalog (if needed)...');
      await catalog.syncCatalog();
    } catch (e) {
      console.warn('[Startup] Catalog sync error:', e.message);
    }
    
    try {
      console.log('[Startup] Running initial deal scrape...');
      await scraper.scrapeAll();
    } catch (e) {
      console.warn('[Startup] Scrape error:', e.message);
    }

    // Start scheduler
    scheduler.startScheduler();
  });
}

startup();
