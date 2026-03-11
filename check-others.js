const db = require('better-sqlite3')('legomarket.db');
const rows = db.prepare(
  "SELECT name, theme_name, franchise, set_num FROM sets WHERE franchise = 'other' AND set_num IN (SELECT set_num FROM deals) ORDER BY RANDOM() LIMIT 60"
).all();
rows.forEach(r => console.log(r.franchise, '|', r.theme_name, '|', r.name.substring(0, 70)));
