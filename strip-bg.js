const { Jimp } = require('jimp');

async function makeTransparent() {
  const image = await Jimp.read('public/logo.png');
  let replaced = 0;
  
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
    const r = image.bitmap.data[idx + 0];
    const g = image.bitmap.data[idx + 1];
    const b = image.bitmap.data[idx + 2];
    
    // Replace pure/near black with complete transparency
    if (r < 25 && g < 25 && b < 25) {
      image.bitmap.data[idx + 3] = 0; // alpha = 0
      replaced++;
    }
  });

  await image.write('public/logo.png');
  console.log('Done! Replaced', replaced, 'pixels with transparency.');
}

makeTransparent().catch(console.error);
