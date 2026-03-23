'use strict';
const https = require('https');
const zlib = require('zlib');
const csv = require('csv-parser');
const db = require('./database');

const THEMES_URL = 'https://cdn.rebrickable.com/media/downloads/themes.csv.gz';
const SETS_URL = 'https://cdn.rebrickable.com/media/downloads/sets.csv.gz';

// Franchise mapping directly from Rebrickable theme IDs (approximation)
// We map root themes or major subthemes to our internal "franchise" slugs.
const mapThemeToFranchise = (themeName, parentId) => {
  const n = (themeName || '').toLowerCase();
  if (n.includes('star wars')) return 'star-wars';
  if (n.includes('harry potter')) return 'harry-potter';
  if (n.includes('technic') || n.includes('bionicle')) return 'technic';
  if (n.includes('city') || n.includes('town') || n.includes('trains')) return 'city';
  if (n.includes('creator') || n.includes('expert') || n.includes('model team')) return 'creator';
  if (n.includes('ideas') || n.includes('cuusoo')) return 'ideas';
  if (n.includes('marvel') || n.includes('super heroes')) return 'marvel';
  if (n.includes('batman') || n.includes('dc')) return 'dc';
  if (n.includes('ninjago')) return 'ninjago';
  if (n.includes('minecraft')) return 'minecraft';
  if (n.includes('speed champions') || n.includes('racers')) return 'speed-champions';
  if (n.includes('architecture')) return 'architecture';
  if (n.includes('icons')) return 'icons';
  if (n.includes('disney')) return 'disney';
  if (n.includes('indiana jones')) return 'indiana-jones';
  if (n.includes('friends') || n.includes('belville')) return 'friends';
  if (n.includes('castle') || n.includes('kingdoms')) return 'castle';
  if (n.includes('pirates')) return 'pirates';
  if (n.includes('space') || n.includes('blacktron')) return 'space';
  
  return 'other';
};

/**
 * Downloads and streams a gzipped CSV into an array of objects
 */
function downloadCSV(url) {
  return new Promise((resolve, reject) => {
    const results = [];
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url} - Status ${res.statusCode}`));
      }
      res.pipe(zlib.createGunzip())
         .pipe(csv())
         .on('data', (data) => results.push(data))
         .on('end', () => resolve(results))
         .on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Downloads themes and sets, parses them, and bulk inserts them into the DB.
 */
async function syncCatalog() {
  try {
    console.log('[Catalog] Checking if DB needs seeding...');
    
    // Check if we already have sets. If we have more than 1000, we probably don't need to reseed from scratch right now.
    const stats = db.getStats();
    if (stats.totalSets > 1000) {
      console.log(`[Catalog] DB already populated (${stats.totalSets} sets). Skipping full CSV sync.`);
      return;
    }

    console.log('[Catalog] Downloading themes.csv.gz...');
    const themesData = await downloadCSV(THEMES_URL);
    const themesMap = {};
    for (const t of themesData) {
      themesMap[t.id] = { name: t.name, parent_id: t.parent_id };
    }
    console.log(`[Catalog] Loaded ${Object.keys(themesMap).length} themes.`);

    console.log('[Catalog] Downloading sets.csv.gz...');
    const setsData = await downloadCSV(SETS_URL);
    console.log(`[Catalog] Loaded ${setsData.length} sets. Formating for DB insertion...`);

    const formattedSets = [];
    for (const s of setsData) {
      // Rebrickable set numbers often have '-1' suffix (e.g., '75192-1').
      // We strip it if it exists to normalize with Dealabs/Avenue de la Brique
      let setNum = s.set_num || '';
      if (setNum.endsWith('-1')) setNum = setNum.slice(0, -2);
      if (!setNum) continue;

      const themeInfo = themesMap[s.theme_id] || {};
      const themeName = themeInfo.name || '';
      
      // Attempt to assign franchise based on theme name (or parent theme if we wanted to walk the tree)
      const franchise = mapThemeToFranchise(themeName, themeInfo.parent_id);

      formattedSets.push({
        set_num: setNum,
        name: s.name,
        year: s.year ? parseInt(s.year) : null,
        num_parts: s.num_parts ? parseInt(s.num_parts) : null,
        theme_id: s.theme_id ? parseInt(s.theme_id) : null,
        theme_name: themeName,
        franchise: franchise,
        img_url: s.img_url || null,
        description: null // Not provided in CSV
      });
    }

    console.log(`[Catalog] Inserting ${formattedSets.length} sets into SQLite (this might take a few seconds)...`);
    db.upsertSetsBulk(formattedSets);
    console.log('[Catalog] ✅ Full catalog sync complete!');

  } catch (err) {
    console.error('[Catalog] Error syncing catalog:', err.message);
  }
}

module.exports = {
  syncCatalog
};
