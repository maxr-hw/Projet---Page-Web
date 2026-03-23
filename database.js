'use strict';
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/legomarket';
const DB_NAME = MONGODB_URI.split('/').pop().split('?')[0] || 'legomarket';

let client;
let db;

async function getDb() {
  if (!db) {
    if (!MONGODB_URI || MONGODB_URI.includes('localhost')) {
      console.warn('[DB] Using local/fallback MongoDB URI. Ensure MONGODB_URI is set in Vercel.');
    }
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await client.connect();
    db = client.db(DB_NAME);
    await initSchema();
  }
  return db;
}

async function initSchema() {
  const d = db || await getDb();
  
  // Sets: _id is set_num
  const sets = d.collection('sets');
  await sets.createIndex({ franchise: 1 });
  await sets.createIndex({ name: 1 });

  // Deals: many per set_num
  const deals = d.collection('deals');
  await deals.createIndex({ set_num: 1 });
  await deals.createIndex({ discount_pct: 1 });

  // Votes: _id is set_num
  const votes = d.collection('votes');
}

// ---- Sets ----

async function upsertSet(set) {
  const d = await getDb();
  const setNum = set.set_num;
  const updateData = { ...set, updated_at: Math.floor(Date.now() / 1000) };
  delete updateData.set_num;

  await d.collection('sets').updateOne(
    { _id: setNum },
    { $set: updateData },
    { upsert: true }
  );
}

async function upsertSetsBulk(sets) {
  const d = await getDb();
  if (!sets.length) return;

  const ops = sets.map(s => ({
    updateOne: {
      filter: { _id: s.set_num },
      update: { $set: { ...s, updated_at: Math.floor(Date.now() / 1000) } },
      upsert: true
    }
  }));

  await d.collection('sets').bulkWrite(ops);
}

async function upsertRetailPrice(setNum, retailPrice) {
  const d = await getDb();
  await d.collection('sets').updateOne(
    { _id: setNum },
    { $set: { retail_price: retailPrice } }
  );
}

async function getSetsNeedingRetailPrice(limit = 50) {
  const d = await getDb();
  // Find sets with no retail price that have deals
  const setNumsWithDeals = await d.collection('deals').distinct('set_num');
  return d.collection('sets')
    .find({ _id: { $in: setNumsWithDeals }, retail_price: null })
    .limit(limit)
    .project({ _id: 1 })
    .toArray()
    .then(rows => rows.map(r => ({ set_num: r._id })));
}

async function getSet(setNum) {
  const d = await getDb();
  const res = await d.collection('sets').findOne({ _id: setNum });
  if (res) res.set_num = res._id;
  return res;
}

async function searchSets(q) {
  const d = await getDb();
  const regex = new RegExp(q, 'i');
  
  // Use aggregation to join with best deal
  const pipeline = [
    {
      $match: {
        $or: [
          { name: regex },
          { _id: regex },
          { theme_name: regex },
          { franchise: regex }
        ]
      }
    },
    { $limit: 40 },
    {
      $lookup: {
        from: 'deals',
        let: { set_num: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$set_num', '$$set_num'] } } },
          { $sort: { price: 1 } },
          { $limit: 1 }
        ],
        as: 'best_deal'
      }
    },
    { $unwind: { path: '$best_deal', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'votes',
        localField: '_id',
        foreignField: '_id',
        as: 'vote_data'
      }
    },
    { $unwind: { path: '$vote_data', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        set_num: '$_id',
        name: 1,
        theme_name: 1,
        num_parts: 1,
        img_url: { $ifNull: ['$img_url', { $concat: ['https://images.brickset.com/sets/images/', '$_id', '.jpg'] }] },
        price: '$best_deal.price',
        original_price: '$best_deal.original_price',
        discount_pct: '$best_deal.discount_pct',
        source: '$best_deal.source',
        source_url: '$best_deal.source_url',
        upvotes: { $ifNull: ['$vote_data.upvotes', 0] },
        downvotes: { $ifNull: ['$vote_data.downvotes', 0] }
      }
    }
  ];

  return d.collection('sets').aggregate(pipeline).toArray();
}

// ---- Deals ----

async function upsertDeals(deals) {
  const d = await getDb();
  if (!deals.length) return;

  const ops = [];
  // For each deal, remove existing one from same source and insert new one
  // In SQLite it was a transaction: delete then insert.
  // In MongoDB we can use bulkWrite or just deleteMany then insertMany.
  
  // Unique set_num/source pairs
  const pairs = deals.map(d => ({ set_num: d.set_num, source: d.source }));
  
  const bulkOps = [];
  for (const deal of deals) {
    // Delete existing
    bulkOps.push({
      deleteMany: {
        filter: { set_num: deal.set_num, source: deal.source }
      }
    });
    // Add new
    bulkOps.push({
      insertOne: {
        document: { ...deal, scraped_at: Math.floor(Date.now() / 1000) }
      }
    });
  }
  
  await d.collection('deals').bulkWrite(bulkOps);
}

async function getDeals({ sort = 'deal', page = 1, limit = 24, franchise = 'all', q = '' } = {}) {
  const d = await getDb();
  const match = {};

  if (franchise && franchise !== 'all') {
    match.franchise = franchise;
  }

  if (q && q.trim().length > 0) {
    const term = new RegExp(q.trim(), 'i');
    match.$or = [
      { name: term },
      { _id: term },
      { theme_name: term },
      { franchise: term }
    ];
  }

  const offset = (page - 1) * limit;

  // Sorting logic
  let sortObj = {};
  switch (sort) {
    case 'discount':
    case 'deal':
      sortObj = { has_deal: 1, discount_pct: 1 }; // has_deal ASC (0 first), discount_pct ASC
      break;
    case 'price-asc':
      sortObj = { has_deal: 1, price: 1 };
      break;
    case 'price-desc':
      sortObj = { has_deal: 1, price: -1 };
      break;
    case 'hot':
      sortObj = { has_deal: 1, score: -1 };
      break;
    case 'newest':
      sortObj = { year: -1 };
      break;
    default:
      sortObj = { has_deal: 1, discount_pct: 1 };
  }

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'deals',
        let: { set_num: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$set_num', '$$set_num'] } } },
          { $sort: { price: 1 } },
          { $limit: 1 }
        ],
        as: 'best_deal'
      }
    },
    { $unwind: { path: '$best_deal', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'votes',
        localField: '_id',
        foreignField: '_id',
        as: 'vote_data'
      }
    },
    { $unwind: { path: '$vote_data', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        has_deal: { $cond: [{ $ifNull: ['$best_deal.price', false] }, 0, 1] },
        score: { $subtract: [{ $ifNull: ['$vote_data.upvotes', 0] }, { $ifNull: ['$vote_data.downvotes', 0] }] }
      }
    },
    { $sort: sortObj },
    { $skip: offset },
    { $limit: limit },
    {
      $project: {
        set_num: '$_id',
        name: 1,
        year: 1,
        num_parts: 1,
        theme_name: 1,
        franchise: 1,
        description: 1,
        retail_price: 1,
        img_url: { $ifNull: ['$img_url', { $concat: ['https://images.brickset.com/sets/images/', '$_id', '.jpg'] }] },
        price: '$best_deal.price',
        original_price: '$best_deal.original_price',
        discount_pct: '$best_deal.discount_pct',
        source: '$best_deal.source',
        source_url: '$best_deal.source_url',
        deal_id: '$best_deal._id',
        upvotes: { $ifNull: ['$vote_data.upvotes', 0] },
        downvotes: { $ifNull: ['$vote_data.downvotes', 0] }
      }
    }
  ];

  return d.collection('sets').aggregate(pipeline).toArray();
}

async function getDealDetail(setNum) {
  const d = await getDb();
  
  const pipeline = [
    { $match: { _id: setNum } },
    {
      $lookup: {
        from: 'votes',
        localField: '_id',
        foreignField: '_id',
        as: 'vote_data'
      }
    },
    { $unwind: { path: '$vote_data', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        set_num: '$_id',
        name: 1,
        year: 1,
        num_parts: 1,
        theme_id: 1,
        theme_name: 1,
        franchise: 1,
        description: 1,
        piece_url: 1,
        updated_at: 1,
        img_url: { $ifNull: ['$img_url', { $concat: ['https://images.brickset.com/sets/images/', '$_id', '.jpg'] }] },
        upvotes: { $ifNull: ['$vote_data.upvotes', 0] },
        downvotes: { $ifNull: ['$vote_data.downvotes', 0] }
      }
    }
  ];

  const results = await d.collection('sets').aggregate(pipeline).toArray();
  const set = results[0];
  if (!set) return null;

  const deals = await d.collection('deals').find({ set_num: setNum }).sort({ price: 1 }).toArray();
  return { ...set, deals };
}

async function getSpotlightDeals(limit = 4) {
  const d = await getDb();
  
  const pipeline = [
    {
      $lookup: {
        from: 'deals',
        let: { set_num: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$set_num', '$$set_num'] } } },
          { $sort: { price: 1 } },
          { $limit: 1 }
        ],
        as: 'best_deal'
      }
    },
    { $unwind: '$best_deal' },
    {
      $match: {
        $or: [
          { 'best_deal.discount_pct': { $lte: -50 } },
          { 'best_deal.original_price': { $gte: 100 } },
          { 'best_deal.price': { $lte: 20 } }
        ]
      }
    },
    {
      $lookup: {
        from: 'votes',
        localField: '_id',
        foreignField: '_id',
        as: 'vote_data'
      }
    },
    { $unwind: { path: '$vote_data', preserveNullAndEmptyArrays: true } },
    {
      $sort: {
        'best_deal.discount_pct': 1
      }
    },
    { $limit: limit },
    {
      $project: {
        set_num: '$_id',
        name: 1,
        year: 1,
        num_parts: 1,
        theme_name: 1,
        franchise: 1,
        description: 1,
        img_url: { $ifNull: ['$img_url', { $concat: ['https://images.brickset.com/sets/images/', '$_id', '.jpg'] }] },
        price: '$best_deal.price',
        original_price: '$best_deal.original_price',
        discount_pct: '$best_deal.discount_pct',
        source: '$best_deal.source',
        source_url: '$best_deal.source_url',
        upvotes: { $ifNull: ['$vote_data.upvotes', 0] },
        downvotes: { $ifNull: ['$vote_data.downvotes', 0] }
      }
    }
  ];

  return d.collection('sets').aggregate(pipeline).toArray();
}

async function getStats() {
  const d = await getDb();
  const totalSets = await d.collection('sets').countDocuments();
  const totalDeals = await d.collection('deals').countDocuments();
  
  const avgDiscountRes = await d.collection('deals').aggregate([
    { $group: { _id: null, avg: { $avg: '$discount_pct' } } }
  ]).toArray();
  const avgDiscount = avgDiscountRes.length ? avgDiscountRes[0].avg : 0;

  const bestDealRes = await d.collection('deals').aggregate([
    { $sort: { discount_pct: 1 } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'sets',
        localField: 'set_num',
        foreignField: '_id',
        as: 'set'
      }
    },
    { $unwind: '$set' },
    { $project: { name: '$set.name', discount_pct: 1 } }
  ]).toArray();
  const bestDeal = bestDealRes[0] || null;

  return { totalSets, totalDeals, avgDiscount: Math.round(avgDiscount || 0), bestDeal };
}

// ---- Votes ----

async function vote(setNum, direction) {
  const d = await getDb();
  
  const update = direction === 'up' ? { $inc: { upvotes: 1 } } : { $inc: { downvotes: 1 } };
  
  // Upsert initial vote logic
  await d.collection('votes').updateOne(
    { _id: setNum },
    { $setOnInsert: { upvotes: 0, downvotes: 0 } },
    { upsert: true }
  );

  await d.collection('votes').updateOne(
    { _id: setNum },
    update
  );

  const res = await d.collection('votes').findOne({ _id: setNum });
  return { ...res, set_num: res._id };
}

async function getFranchises() {
  const d = await getDb();
  
  const pipeline = [
    {
      $lookup: {
        from: 'deals',
        localField: '_id',
        foreignField: 'set_num',
        as: 'deals'
      }
    },
    { $unwind: '$deals' },
    { $match: { franchise: { $ne: null, $ne: '' } } },
    {
      $group: {
        _id: '$franchise',
        count: { $sum: 1 },
        best_discount: { $min: '$deals.discount_pct' }
      }
    },
    { $sort: { count: -1 } },
    { $project: { franchise: '$_id', count: 1, best_discount: 1, _id: 0 } }
  ];

  return d.collection('sets').aggregate(pipeline).toArray();
}

module.exports = {
  getDb, upsertSet, upsertSetsBulk, getSet, upsertDeals, getDeals,
  getDealDetail, getSpotlightDeals, getStats, vote,
  getFranchises, searchSets, upsertRetailPrice, getSetsNeedingRetailPrice
};
