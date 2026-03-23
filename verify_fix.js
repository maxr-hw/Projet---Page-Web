const { scrapeAll } = require('./scraper');

async function verifyFix() {
  console.log('Testing Dealabs scraping after fix...');
  const deals = await scrapeAll();
  const dealabsDeals = deals.filter(d => d.source === 'Dealabs');
  
  if (dealabsDeals.length > 0) {
    console.log(`Found ${dealabsDeals.length} Dealabs deals.`);
    // We need to check the DB to see if img_url was saved correctly, 
    // but the scraper function itself returns deals which don't have img_url (they are in the sets table).
    // Let's check the database.
    const db = require('./database');
    for (const deal of dealabsDeals.slice(0, 5)) {
      const set = await db.getSet(deal.set_num);
      console.log(`Set ${deal.set_num}: img_url = ${set.img_url ? 'PRESENT' : 'MISSING'}`);
      if (set.img_url) console.log(`   URL: ${set.img_url}`);
    }
  } else {
    console.log('No Dealabs deals found in this cycle.');
  }
}

verifyFix().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
