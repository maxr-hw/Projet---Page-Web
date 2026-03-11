'use strict';
/**
 * One-time (and re-runnable) script to retroactively re-tag all sets
 * whose franchise is 'other' using the comprehensive keyword map.
 * Run with: node retag-franchises.js
 */
const db = require('better-sqlite3')('legomarket.db');
const { guessFranchiseFromText } = require('./scraper');

const rows = db.prepare("SELECT set_num, name, theme_name FROM sets WHERE franchise = 'other' OR franchise IS NULL").all();
let updated = 0;

const update = db.prepare("UPDATE sets SET franchise = ? WHERE set_num = ?");

const runAll = db.transaction(() => {
  for (const row of rows) {
    const guessed = guessFranchiseFromText(row.name, row.theme_name);
    if (guessed) {
      update.run(guessed, row.set_num);
      updated++;
    }
  }
});

runAll();
console.log(`Re-tagged ${updated} / ${rows.length} sets from 'other' to a known franchise.`);
