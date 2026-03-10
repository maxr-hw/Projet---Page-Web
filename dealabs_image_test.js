const fs = require('fs');
const html = fs.readFileSync('dealabs_debug.html', 'utf-8');
const urls = html.match(/https:\/\/static-pepper\.dealabs\.com\/[^\"]+/g);
console.log('Found Pepper URLs:', urls ? urls.slice(0, 5) : 'none');
