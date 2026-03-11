'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'legomarket.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sets (
      set_num       TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      year          INTEGER,
      num_parts     INTEGER,
      theme_id      INTEGER,
      theme_name    TEXT,
      franchise     TEXT,
      img_url       TEXT,
      description   TEXT,
      piece_url     TEXT,
      retail_price  REAL,
      updated_at    INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS deals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      set_num       TEXT NOT NULL,
      source        TEXT NOT NULL,
      source_url    TEXT,
      price         REAL NOT NULL,
      original_price REAL,
      discount_pct  INTEGER,
      scraped_at    INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (set_num) REFERENCES sets(set_num) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      set_num       TEXT PRIMARY KEY,
      upvotes       INTEGER DEFAULT 0,
      downvotes     INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_deals_set_num ON deals(set_num);
    CREATE INDEX IF NOT EXISTS idx_deals_discount ON deals(discount_pct);
    CREATE INDEX IF NOT EXISTS idx_sets_franchise ON sets(franchise);
    CREATE INDEX IF NOT EXISTS idx_sets_name ON sets(name);
  `);
}

// ---- Sets ----

function upsertSet(set) {
  const d = getDb();
  d.prepare(`
    INSERT INTO sets (set_num, name, year, num_parts, theme_id, theme_name, franchise, img_url, description, piece_url, updated_at)
    VALUES (@set_num, @name, @year, @num_parts, @theme_id, @theme_name, @franchise, @img_url, @description, @piece_url, strftime('%s','now'))
    ON CONFLICT(set_num) DO UPDATE SET
      name        = excluded.name,
      year        = excluded.year,
      num_parts   = excluded.num_parts,
      theme_id    = excluded.theme_id,
      theme_name  = excluded.theme_name,
      franchise   = excluded.franchise,
      img_url     = excluded.img_url,
      description = excluded.description,
      piece_url   = excluded.piece_url,
      updated_at  = excluded.updated_at
  `).run(set);
}

function upsertSetsBulk(sets) {
  const d = getDb();
  const insert = d.prepare(`
    INSERT INTO sets (set_num, name, year, num_parts, theme_id, theme_name, franchise, img_url, updated_at)
    VALUES (@set_num, @name, @year, @num_parts, @theme_id, @theme_name, @franchise, @img_url, strftime('%s','now'))
    ON CONFLICT(set_num) DO UPDATE SET
      name        = excluded.name,
      year        = excluded.year,
      num_parts   = excluded.num_parts,
      theme_id    = excluded.theme_id,
      theme_name  = excluded.theme_name,
      franchise   = excluded.franchise,
      img_url     = excluded.img_url,
      updated_at  = excluded.updated_at
  `);

  const runAll = d.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  runAll(sets);
}

function upsertRetailPrice(setNum, retailPrice) {
  getDb().prepare(`
    UPDATE sets SET retail_price = ? WHERE set_num = ?
  `).run(retailPrice, setNum);
}

function getSetsNeedingRetailPrice(limit = 50) {
  return getDb().prepare(`
    SELECT DISTINCT s.set_num FROM sets s
    INNER JOIN deals d ON d.set_num = s.set_num
    WHERE s.retail_price IS NULL
    LIMIT ?
  `).all(limit);
}

function getSet(setNum) {
  return getDb().prepare('SELECT * FROM sets WHERE set_num = ?').get(setNum);
}

function searchSets(q) {
  const like = `%${q}%`;
  return getDb().prepare(`
    SELECT s.set_num, s.name, s.theme_name, s.num_parts,
           COALESCE(s.img_url, 'https://images.brickset.com/sets/images/' || s.set_num || '.jpg') as img_url,
           d.price, d.original_price, d.discount_pct, d.source, d.source_url,
           v.upvotes, v.downvotes
    FROM sets s
    LEFT JOIN deals d ON d.set_num = s.set_num AND d.id = (
      SELECT id FROM deals WHERE set_num = s.set_num ORDER BY price ASC LIMIT 1
    )
    LEFT JOIN votes v ON v.set_num = s.set_num
    WHERE s.name LIKE ? OR s.set_num LIKE ? OR s.theme_name LIKE ? OR s.franchise LIKE ?
    LIMIT 40
  `).all(like, like, like, like);
}

// ---- Deals ----

function upsertDeals(deals) {
  const d = getDb();
  const insert = d.prepare(`
    INSERT INTO deals (set_num, source, source_url, price, original_price, discount_pct, scraped_at)
    VALUES (@set_num, @source, @source_url, @price, @original_price, @discount_pct, strftime('%s','now'))
  `);
  const deleteOld = d.prepare('DELETE FROM deals WHERE set_num = ? AND source = ?');

  const runAll = d.transaction((rows) => {
    for (const row of rows) {
      deleteOld.run(row.set_num, row.source);
      insert.run(row);
    }
  });
  runAll(deals);
}

function getDeals({ sort = 'deal', page = 1, limit = 24, franchise = 'all', q = '' } = {}) {
  const where = [];
  const params = [];

  if (franchise && franchise !== 'all') {
    where.push('s.franchise = ?');
    params.push(franchise);
  }

  if (q && q.trim().length > 0) {
    const term = `%${q.trim()}%`;
    where.push('(s.name LIKE ? OR s.set_num LIKE ? OR s.theme_name LIKE ? OR s.franchise LIKE ?)');
    params.push(term, term, term, term);
  }

  if (where.length === 0) {
    where.push('1=1');
  }

  // Ensure deals appear first before catalog items without deals
  const orderMap = {
    deal:       'CASE WHEN d.id IS NULL THEN 1 ELSE 0 END ASC, d.discount_pct ASC',
    discount:   'CASE WHEN d.id IS NULL THEN 1 ELSE 0 END ASC, d.discount_pct ASC',
    'price-asc': 'CASE WHEN d.id IS NULL THEN 1 ELSE 0 END ASC, d.price ASC',
    'price-desc':'CASE WHEN d.id IS NULL THEN 1 ELSE 0 END ASC, d.price DESC',
    hot:        'CASE WHEN d.id IS NULL THEN 1 ELSE 0 END ASC, (COALESCE(v.upvotes,0) - COALESCE(v.downvotes,0)) DESC',
    newest:     's.year DESC',
  };
  const order = orderMap[sort] || orderMap['deal'];

  const offset = (page - 1) * limit;

  const sql = `
    SELECT 
      s.set_num, s.name, s.year, s.num_parts, s.theme_name, s.franchise, s.description,
      s.retail_price,
      COALESCE(NULLIF(s.img_url, ''), 'https://images.brickset.com/sets/images/' || s.set_num || '.jpg') as img_url,
      d.price, d.original_price, d.discount_pct, d.source, d.source_url, d.id as deal_id,
      COALESCE(v.upvotes, 0) as upvotes,
      COALESCE(v.downvotes, 0) as downvotes
    FROM sets s
    LEFT JOIN deals d ON d.set_num = s.set_num AND d.id = (
      SELECT id FROM deals WHERE set_num = s.set_num ORDER BY price ASC LIMIT 1
    )
    LEFT JOIN votes v ON v.set_num = s.set_num
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);
  return getDb().prepare(sql).all(...params);
}

function getDealDetail(setNum) {
  const set = getDb().prepare(`
    SELECT s.set_num, s.name, s.year, s.num_parts, s.theme_id, s.theme_name, s.franchise, s.description, s.piece_url, s.updated_at,
           COALESCE(NULLIF(s.img_url, ''), 'https://images.brickset.com/sets/images/' || s.set_num || '.jpg') as img_url,
           COALESCE(v.upvotes,0) as upvotes, COALESCE(v.downvotes,0) as downvotes
    FROM sets s LEFT JOIN votes v ON v.set_num = s.set_num
    WHERE s.set_num = ?
  `).get(setNum);

  if (!set) return null;

  const deals = getDb().prepare(`
    SELECT * FROM deals WHERE set_num = ? ORDER BY price ASC
  `).all(setNum);

  return { ...set, deals };
}

function getSpotlightDeals(limit = 4) {
  return getDb().prepare(`
    SELECT 
      s.set_num, s.name, s.year, s.num_parts, s.theme_name, s.franchise, s.description,
      COALESCE(NULLIF(s.img_url, ''), 'https://images.brickset.com/sets/images/' || s.set_num || '.jpg') as img_url,
      d.price, d.original_price, d.discount_pct, d.source, d.source_url,
      COALESCE(v.upvotes,0) as upvotes, COALESCE(v.downvotes,0) as downvotes
    FROM sets s
    INNER JOIN deals d ON d.set_num = s.set_num AND d.id = (
      SELECT id FROM deals WHERE set_num = s.set_num ORDER BY price ASC LIMIT 1
    )
    LEFT JOIN votes v ON v.set_num = s.set_num
    WHERE d.discount_pct <= -50 OR d.original_price >= 100 OR d.price <= 20
    ORDER BY CASE WHEN d.discount_pct <= -50 THEN 0 ELSE 1 END ASC, d.discount_pct ASC
    LIMIT ?
  `).all(limit);
}

function getStats() {
  const d = getDb();
  const totalSets  = d.prepare('SELECT COUNT(*) as n FROM sets').get().n;
  const totalDeals = d.prepare('SELECT COUNT(*) as n FROM deals').get().n;
  const avgDiscount = d.prepare('SELECT AVG(discount_pct) as a FROM deals').get().a;
  const bestDeal   = d.prepare(`
    SELECT s.name, d.discount_pct FROM deals d
    JOIN sets s ON s.set_num = d.set_num
    ORDER BY d.discount_pct ASC LIMIT 1
  `).get();
  return { totalSets, totalDeals, avgDiscount: Math.round(avgDiscount || 0), bestDeal };
}

// ---- Votes ----

function vote(setNum, direction) {
  const d = getDb();
  d.prepare(`
    INSERT INTO votes (set_num, upvotes, downvotes) VALUES (?, 0, 0)
    ON CONFLICT(set_num) DO NOTHING
  `).run(setNum);

  if (direction === 'up') {
    d.prepare('UPDATE votes SET upvotes = upvotes + 1 WHERE set_num = ?').run(setNum);
  } else {
    d.prepare('UPDATE votes SET downvotes = downvotes + 1 WHERE set_num = ?').run(setNum);
  }
  return d.prepare('SELECT * FROM votes WHERE set_num = ?').get(setNum);
}

function getFranchises() {
  return getDb().prepare(`
    SELECT franchise, COUNT(*) as count, MIN(d.discount_pct) as best_discount
    FROM sets s
    INNER JOIN deals d ON d.set_num = s.set_num
    WHERE franchise IS NOT NULL AND franchise != ''
    GROUP BY franchise
    ORDER BY count DESC
  `).all();
}

module.exports = {
  getDb, upsertSet, upsertSetsBulk, getSet, upsertDeals, getDeals,
  getDealDetail, getSpotlightDeals, getStats, vote,
  getFranchises, searchSets, upsertRetailPrice, getSetsNeedingRetailPrice
};
