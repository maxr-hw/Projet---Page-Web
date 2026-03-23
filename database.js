'use strict';
const { createClient } = require('@libsql/client');
const path = require('path');

// Initialize Turso client
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'legomarket.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function getDb() {
  await initSchema();
  return client;
}

// In-memory cache to skip repeated schema init during a single function lifecycle
let schemaInitialized = false;

async function initSchema() {
  if (schemaInitialized) return;
  
  await client.batch([
    `CREATE TABLE IF NOT EXISTS sets (
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
    );`,
    `CREATE TABLE IF NOT EXISTS deals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      set_num       TEXT NOT NULL,
      source        TEXT NOT NULL,
      source_url    TEXT,
      price         REAL NOT NULL,
      original_price REAL,
      discount_pct  INTEGER,
      scraped_at    INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (set_num) REFERENCES sets(set_num) ON DELETE CASCADE
    );`,
    `CREATE TABLE IF NOT EXISTS votes (
      set_num       TEXT PRIMARY KEY,
      upvotes       INTEGER DEFAULT 0,
      downvotes     INTEGER DEFAULT 0
    );`,
    `CREATE INDEX IF NOT EXISTS idx_deals_set_num ON deals(set_num);`,
    `CREATE INDEX IF NOT EXISTS idx_deals_discount ON deals(discount_pct);`,
    `CREATE INDEX IF NOT EXISTS idx_sets_franchise ON sets(franchise);`,
    `CREATE INDEX IF NOT EXISTS idx_sets_name ON sets(name);`
  ], "write");
  
  schemaInitialized = true;
}

// ---- Sets ----

async function upsertSet(set) {
  await client.execute({
    sql: `
      INSERT INTO sets (set_num, name, year, num_parts, theme_id, theme_name, franchise, img_url, description, piece_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
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
    `,
    args: [
      set.set_num, set.name, set.year, set.num_parts, set.theme_id, 
      set.theme_name, set.franchise, set.img_url, set.description, set.piece_url
    ]
  });
}

async function upsertSetsBulk(sets) {
  if (!sets.length) return;
  const batch = sets.map(set => ({
    sql: `
      INSERT INTO sets (set_num, name, year, num_parts, theme_id, theme_name, franchise, img_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
      ON CONFLICT(set_num) DO UPDATE SET
        name        = excluded.name,
        year        = excluded.year,
        num_parts   = excluded.num_parts,
        theme_id    = excluded.theme_id,
        theme_name  = excluded.theme_name,
        franchise   = excluded.franchise,
        img_url     = excluded.img_url,
        updated_at  = excluded.updated_at
    `,
    args: [
      set.set_num, set.name, set.year, set.num_parts, set.theme_id, 
      set.theme_name, set.franchise, set.img_url
    ]
  }));
  await client.batch(batch, "write");
}

async function upsertRetailPrice(setNum, retailPrice) {
  await client.execute({
    sql: `UPDATE sets SET retail_price = ? WHERE set_num = ?`,
    args: [retailPrice, setNum]
  });
}

async function getSetsNeedingRetailPrice(limit = 50) {
  const res = await client.execute({
    sql: `
      SELECT DISTINCT s.set_num FROM sets s
      INNER JOIN deals d ON d.set_num = s.set_num
      WHERE s.retail_price IS NULL
      LIMIT ?
    `,
    args: [limit]
  });
  return res.rows;
}

async function getSet(setNum) {
  const res = await client.execute({
    sql: 'SELECT * FROM sets WHERE set_num = ?',
    args: [setNum]
  });
  return res.rows[0];
}

async function searchSets(q) {
  const term = `%${q}%`;
  const res = await client.execute({
    sql: `
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
    `,
    args: [term, term, term, term]
  });
  return res.rows;
}

// ---- Deals ----

async function upsertDeals(deals) {
  if (!deals.length) return;
  const batch = [];
  for (const row of deals) {
    batch.push({
      sql: 'DELETE FROM deals WHERE set_num = ? AND source = ?',
      args: [row.set_num, row.source]
    });
    batch.push({
      sql: `
        INSERT INTO deals (set_num, source, source_url, price, original_price, discount_pct, scraped_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
      `,
      args: [row.set_num, row.source, row.source_url, row.price, row.original_price, row.discount_pct]
    });
  }
  await client.batch(batch, "write");
}

async function getDeals({ sort = 'deal', page = 1, limit = 24, franchise = 'all', q = '' } = {}) {
  const where = [];
  const args = [];

  if (franchise && franchise !== 'all') {
    where.push('s.franchise = ?');
    args.push(franchise);
  }

  if (q && q.trim().length > 0) {
    const term = `%${q.trim()}%`;
    where.push('(s.name LIKE ? OR s.set_num LIKE ? OR s.theme_name LIKE ? OR s.franchise LIKE ?)');
    args.push(term, term, term, term);
  }

  if (where.length === 0) where.push('1=1');

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

  args.push(limit, offset);
  const res = await client.execute({ sql, args });
  return res.rows;
}

async function getDealDetail(setNum) {
  const setRes = await client.execute({
    sql: `
      SELECT s.set_num, s.name, s.year, s.num_parts, s.theme_id, s.theme_name, s.franchise, s.description, s.piece_url, s.updated_at,
             COALESCE(NULLIF(s.img_url, ''), 'https://images.brickset.com/sets/images/' || s.set_num || '.jpg') as img_url,
             COALESCE(v.upvotes,0) as upvotes, COALESCE(v.downvotes,0) as downvotes
      FROM sets s LEFT JOIN votes v ON v.set_num = s.set_num
      WHERE s.set_num = ?
    `,
    args: [setNum]
  });

  const set = setRes.rows[0];
  if (!set) return null;

  const dealsRes = await client.execute({
    sql: `SELECT * FROM deals WHERE set_num = ? ORDER BY price ASC`,
    args: [setNum]
  });

  return { ...set, deals: dealsRes.rows };
}

async function getSpotlightDeals(limit = 4) {
  const res = await client.execute({
    sql: `
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
    `,
    args: [limit]
  });
  return res.rows;
}

async function getStats() {
  const totalSets  = (await client.execute('SELECT COUNT(*) as n FROM sets')).rows[0].n;
  const totalDeals = (await client.execute('SELECT COUNT(*) as n FROM deals')).rows[0].n;
  const avgDiscount = (await client.execute('SELECT AVG(discount_pct) as a FROM deals')).rows[0].a;
  const bestDeal   = (await client.execute(`
    SELECT s.name, d.discount_pct FROM deals d
    JOIN sets s ON s.set_num = d.set_num
    ORDER BY d.discount_pct ASC LIMIT 1
  `)).rows[0];
  return { totalSets, totalDeals, avgDiscount: Math.round(avgDiscount || 0), bestDeal };
}

// ---- Votes ----

async function vote(setNum, direction) {
  await client.execute({
    sql: `INSERT INTO votes (set_num, upvotes, downvotes) VALUES (?, 0, 0) ON CONFLICT(set_num) DO NOTHING`,
    args: [setNum]
  });

  if (direction === 'up') {
    await client.execute({ sql: 'UPDATE votes SET upvotes = upvotes + 1 WHERE set_num = ?', args: [setNum] });
  } else {
    await client.execute({ sql: 'UPDATE votes SET downvotes = downvotes + 1 WHERE set_num = ?', args: [setNum] });
  }
  const res = await client.execute({ sql: 'SELECT * FROM votes WHERE set_num = ?', args: [setNum] });
  return res.rows[0];
}

async function getFranchises() {
  const res = await client.execute(`
    SELECT franchise, COUNT(*) as count, MIN(d.discount_pct) as best_discount
    FROM sets s
    INNER JOIN deals d ON d.set_num = s.set_num
    WHERE franchise IS NOT NULL AND franchise != ''
    GROUP BY franchise
    ORDER BY count DESC
  `);
  return res.rows;
}

module.exports = {
  getDb, upsertSet, upsertSetsBulk, getSet, upsertDeals, getDeals,
  getDealDetail, getSpotlightDeals, getStats, vote,
  getFranchises, searchSets, upsertRetailPrice, getSetsNeedingRetailPrice
};
