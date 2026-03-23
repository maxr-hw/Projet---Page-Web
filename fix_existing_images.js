'use strict';
/**
 * Script to fix existing Dealabs sets with empty img_url.
 * Run this with: MONGODB_URI=your_uri node fix_existing_images.js
 */

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./database');

async function fixImages() {
  console.log('[Fix] Connecting to DB...');
  const d = await db.getDb();
  
  // Find sets from Dealabs with empty or missing img_url
  // Note: We search for sets where piece_url contains dealabs
  const sets = await d.collection('sets').find({
    piece_url: /dealabs\.com/,
    $or: [{ img_url: "" }, { img_url: null }]
  }).toArray();

  console.log(`[Fix] Found ${sets.length} sets to fix.`);

  for (const set of sets) {
    try {
      console.log(`[Fix] Processing ${set._id}: ${set.name}...`);
      
      const { data: html } = await axios.get(set.piece_url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36',
        }
      });

      const $ = cheerio.load(html);
      const vueDataStr = $('[data-vue3]').first().attr('data-vue3');
      
      if (vueDataStr) {
        const thread = JSON.parse(vueDataStr).props.thread;
        if (thread && thread.mainImage) {
          const { path, name } = thread.mainImage;
          const imgUrl = `https://static-pepper.dealabs.com/${path}/${name}.jpg`;
          
          await d.collection('sets').updateOne(
            { _id: set._id },
            { $set: { img_url: imgUrl, updated_at: Math.floor(Date.now() / 1000) } }
          );
          console.log(`   ✓ Fixed! URL: ${imgUrl}`);
        } else {
          console.log(`   ✗ No image data found in JSON.`);
        }
      } else {
        console.log(`   ✗ Could not find data-vue3 attribute.`);
      }

      // Small delay to be polite
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`   ✗ Error fixing ${set._id}: ${err.message}`);
    }
  }

  console.log('[Fix] Completed.');
  process.exit(0);
}

fixImages().catch(err => {
  console.error('[Fix] Fatal error:', err);
  process.exit(1);
});
