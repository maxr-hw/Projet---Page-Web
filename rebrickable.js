'use strict';
const axios = require('axios');

const BASE = 'https://rebrickable.com/api/v3/lego';

// Map Rebrickable theme names → our franchise slugs
const THEME_MAP = {
  'Star Wars':          'star-wars',
  'Harry Potter':       'harry-potter',
  'Technic':            'technic',
  'City':               'city',
  'Creator':            'creator',
  'Creator Expert':     'creator',
  'Ideas':              'ideas',
  'Pokémon':            'pokemon',
  'Marvel Super Heroes':'marvel',
  'DC Comics Super Heroes': 'dc',
  'The Lord of the Rings': 'lotr',
  'Indiana Jones':      'indiana-jones',
  'Jurassic World':     'jurassic',
  'Minecraft':          'minecraft',
  'Ninjago':            'ninjago',
  'Disney':             'disney',
  'Architecture':       'architecture',
  'Icons':              'icons',
  'Speed Champions':    'speed-champions',
  'Dreamzzz':           'dreamzzz',
};

function getApiKey() {
  return process.env.REBRICKABLE_API_KEY || '';
}

function mapFranchise(themeName) {
  if (!themeName) return 'other';
  for (const [key, val] of Object.entries(THEME_MAP)) {
    if (themeName.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return themeName.toLowerCase().replace(/\s+/g, '-');
}

// Throttle: track last request time
let lastRequestTime = 0;
async function throttledGet(url, params) {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastRequestTime));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();

  const key = getApiKey();
  if (!key || key === 'your_api_key_here') {
    throw new Error('Missing Rebrickable API key in .env');
  }

  const res = await axios.get(url, {
    params: { ...params, key },
    timeout: 10000,
    headers: { 'Accept': 'application/json' }
  });
  return res.data;
}

// Fetch a single set by set number (e.g. "75367-1")
async function fetchSet(setNum) {
  try {
    const fullNum = setNum.includes('-') ? setNum : `${setNum}-1`;
    const data = await throttledGet(`${BASE}/sets/${fullNum}/`);
    return normalizeSet(data);
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// Fetch sets by theme ID
async function fetchSetsByTheme(themeId, pageSize = 20) {
  try {
    const data = await throttledGet(`${BASE}/sets/`, {
      theme_id: themeId,
      page_size: pageSize,
      ordering: '-year'
    });
    return (data.results || []).map(normalizeSet);
  } catch (err) {
    console.warn(`[Rebrickable] fetchSetsByTheme error for theme ${themeId}:`, err.message);
    return [];
  }
}

// Fetch all available themes
async function fetchThemes() {
  try {
    const data = await throttledGet(`${BASE}/themes/`, { page_size: 1000 });
    return data.results || [];
  } catch (err) {
    console.warn('[Rebrickable] fetchThemes error:', err.message);
    return [];
  }
}

// Popular theme IDs we want to seed
const SEED_THEMES = [
  { id: 171, name: 'Star Wars' },
  { id: 246, name: 'Harry Potter' },
  { id: 1,   name: 'Technic' },
  { id: 672, name: 'City' },
  { id: 77,  name: 'Creator' },
  { id: 408, name: 'Ideas' },
  { id: 76,  name: 'Marvel Super Heroes' },
  { id: 155, name: 'Architecture' },
  { id: 435, name: 'Speed Champions' },
  { id: 494, name: 'Ninjago' },
];

async function seedFromRebrickable(upsertSet) {
  console.log('[Rebrickable] Starting seed from API...');
  for (const theme of SEED_THEMES) {
    console.log(`[Rebrickable] Fetching theme: ${theme.name} (id ${theme.id})`);
    try {
      const sets = await fetchSetsByTheme(theme.id, 24);
      for (const set of sets) {
        if (!set) continue;
        set.franchise = mapFranchise(theme.name);
        set.theme_name = theme.name;
        upsertSet(set);
      }
      console.log(`[Rebrickable] ✓ ${sets.length} sets for ${theme.name}`);
    } catch (err) {
      console.warn(`[Rebrickable] Error for theme ${theme.name}: ${err.message}`);
    }
  }
  console.log('[Rebrickable] Seed complete.');
}

function normalizeSet(raw) {
  return {
    set_num:    raw.set_num,
    name:       raw.name,
    year:       raw.year,
    num_parts:  raw.num_parts,
    theme_id:   raw.theme_id,
    theme_name: raw.theme_name || '',
    franchise:  mapFranchise(raw.theme_name),
    img_url:    raw.set_img_url || raw.set_url || '',
    description: '',
    piece_url:  raw.set_url || '',
  };
}

module.exports = { fetchSet, fetchSetsByTheme, fetchThemes, seedFromRebrickable, mapFranchise, SEED_THEMES };
