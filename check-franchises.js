const db = require('better-sqlite3')('legomarket.db');
const rows = db.prepare("SELECT franchise, COUNT(*) as n FROM sets WHERE set_num IN (SELECT set_num FROM deals) GROUP BY franchise ORDER BY n DESC LIMIT 30").all();
rows.forEach(r => console.log(`${r.n.toString().padStart(4)} ${r.franchise}`));
