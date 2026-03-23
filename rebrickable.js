'use strict';
const axios = require('axios');

const BASE = 'https://rebrickable.com/api/v3/lego';

// Map Rebrickable theme names → our franchise slugs
const THEME_MAP = {
  // Licensed / Franchises
  'Star Wars':          'star-wars',
  'Harry Potter':       'harry-potter',
  'Marvel Super Heroes':'marvel',
  'DC Comics Super Heroes': 'dc',
  'Batman':             'dc',
  'Spider-Man':         'marvel',
  'The Lord of the Rings': 'lotr',
  'The Hobbit':         'lotr',
  'Indiana Jones':      'indiana-jones',
  'Jurassic World':     'jurassic',
  'Jurassic Park':      'jurassic',
  'Minecraft':          'minecraft',
  'Disney':             'disney',
  'Super Mario':        'mario',
  'Sonic the Hedgehog': 'sonic',
  'Animal Crossing':    'animal-crossing',
  'Avatar':             'avatar',
  'Stranger Things':    'stranger-things',
  'Overwatch':          'overwatch',
  'The Simpsons':       'simpsons',
  'Scooby-Doo':         'scooby-doo',
  'Ghostbusters':       'ghostbusters',
  'Back to the Future': 'bttf',
  'The Muppets':        'muppets',
  'Looney Tunes':       'looney-tunes',
  'SpongeBob SquarePants': 'spongebob',
  'Toy Story':          'toy-story',
  'Cars':               'cars',
  'Pirates of the Caribbean': 'potc',
  'Transformers':       'transformers',
  'Horizon':            'horizon',
  'Fortnite':           'fortnite',
  'Wicked':             'wicked',
  'Wednesday':          'wednesday',
  'Despicable Me 4':    'minions',
  'Minions':            'minions',
  'Gabby\'s Dollhouse': 'gabbys-dollhouse',
  'Trolls World Tour':  'trolls',
  'Angry Birds':        'angry-birds',
  'Pokémon':            'pokemon',

  // Original LEGO Themes
  'Technic':            'technic',
  'City':               'city',
  'Ninjago':            'ninjago',
  'Dreamzzz':           'dreamzzz',
  'Monkie Kid':         'monkie-kid',
  'Friends':            'friends',
  'Architecture':       'architecture',
  'Icons':              'icons',
  'Ideas':              'ideas',
  'Creator':            'creator',
  'Creator Expert':     'creator',
  'Speed Champions':    'speed-champions',
  'Classic':            'classic',
  'Duplo':              'duplo',
  'BrickHeadz':         'brickheadz',
  'Art':                'art',
  'Botanical Collection': 'botanicals',
  'Hidden Side':        'hidden-side',
  'Vidiyo':             'vidiyo',
  'Bionicle':           'bionicle',
  'Hero Factory':       'hero-factory',
  'Castle':             'castle',
  'Pirates':            'pirates',
  'Space':              'space',
  'Western':            'western',
  'Vikings':            'vikings',
  'Adventurers':        'adventurers',
  'Power Miners':       'power-miners',
  'Rock Raiders':       'rock-raiders',
  'Monster Fighters':   'monster-fighters',
  'Pharaoh\'s Quest':   'pharaohs-quest',
  'Dino':               'dino',
  'Unikitty!':          'unikitty',
  'The LEGO Movie':     'lego-movie',
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
  { id: 571, name: 'Minecraft' },
  { id: 694, name: 'Super Mario' },
  { id: 712, name: 'Sonic the Hedgehog' },
  { id: 497, name: 'Friends' },
  { id: 721, name: 'Icons' },
  { id: 714, name: 'Avatar' },
  { id: 11,  name: 'Bionicle' },
  { id: 579, name: 'Disney' },
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
