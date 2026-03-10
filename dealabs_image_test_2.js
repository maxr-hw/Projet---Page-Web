const fs = require('fs');
const html = fs.readFileSync('dealabs_debug.html', 'utf-8');
const urls = html.match(/https:\/\/[^\"]+\.(?:jpg|jpeg|png|webp)/ig);
console.log('Found Any Image URLs:', urls ? urls.slice(0, 10) : 'none');
