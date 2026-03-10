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
  'star-wars':      { label: 'Star Wars',          icon: 'rocket_launch', color: '#4A90D9' },
  'harry-potter':   { label: 'Harry Potter',       icon: 'electric_bolt', color: '#7B5EA7' },
  'technic':        { label: 'Technic',            icon: 'settings',      color: '#E07B39' },
  'city':           { label: 'City',               icon: 'location_city', color: '#5BA85C' },
  'creator':        { label: 'Creator',            icon: 'brush',         color: '#D4A030' },
  'ideas':          { label: 'Ideas',              icon: 'lightbulb',     color: '#C97C3A' },
  'marvel':         { label: 'Marvel',             icon: 'shield',        color: '#B84B2A' },
  'dc':             { label: 'DC',                 icon: 'dark_mode',     color: '#2C3E6B' },
  'ninjago':        { label: 'Ninjago',            icon: 'swords',        color: '#C0392B' },
  'minecraft':      { label: 'Minecraft',          icon: 'grid_view',     color: '#6B8E23' },
  'pokemon':        { label: 'Pokémon',            icon: 'catching_pokemon', color: '#F5B01A' },
  'speed-champions':{ label: 'Speed Champions',    icon: 'speed',         color: '#E74C3C' },
  'architecture':   { label: 'Architecture',       icon: 'home_work',     color: '#95A5A6' },
  'icons':          { label: 'Icons',              icon: 'diamond',       color: '#E8922A' },
  'disney':         { label: 'Disney',             icon: 'castle',        color: '#2E86C1' },
  'indiana-jones':  { label: 'Indiana Jones',      icon: 'map',           color: '#A0522D' },
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

// GET /api/refresh – manually trigger a scrape + optional rebrickable seed
app.get('/api/refresh', async (req, res) => {
  try {
    console.log('[API] Manual refresh triggered');
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
