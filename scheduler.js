'use strict';
const cron    = require('node-cron');
const scraper = require('./scraper');

// Scrape every 2 hours
function startScheduler() {
  console.log('[Scheduler] Registered cron job: scrape every 2 hours');
  cron.schedule('0 */2 * * *', async () => {
    console.log('[Scheduler] Running scheduled scrape...');
    try {
      await scraper.scrapeAll();
    } catch (err) {
      console.error('[Scheduler] Scrape error:', err.message);
    }
  });
}

module.exports = { startScheduler };
