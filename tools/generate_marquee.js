#!/usr/bin/env node
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

async function main() {
  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 1400,
    height: 560,
    deviceScaleFactor: 2 // High-DPI supersampling
  });

  const htmlPath = path.resolve(__dirname, 'marquee.html');
  console.log(`Loading ${htmlPath}...`);
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  // Brief delay to ensure all CSS gradients and fonts have painted
  await new Promise(r => setTimeout(r, 600));

  const tmpPng = path.resolve(__dirname, 'tmp_marquee.png');
  console.log('Capturing screenshot...');
  await page.screenshot({
    path: tmpPng,
    clip: {
      x: 0,
      y: 0,
      width: 1400,
      height: 560
    }
  });

  await browser.close();
  console.log(`Rendered supersampled screenshot to ${tmpPng}`);

  // Process with Python PIL to guarantee 1400x560 24-bit RGB (no alpha)
  const pyScript = `
from PIL import Image
import os

tmp_path = '${tmpPng}'
im = Image.open(tmp_path)
im_resized = im.resize((1400, 560), Image.Resampling.LANCZOS)
im_rgb = im_resized.convert('RGB') # Strip alpha channel for 24-bit RGB

out_png = os.path.join('${path.resolve(__dirname, '../store_assets')}', 'marquee_promo_1400x560.png')
out_jpg = os.path.join('${path.resolve(__dirname, '../store_assets')}', 'marquee_promo_1400x560.jpg')

im_rgb.save(out_png, format='PNG', optimize=True)
im_rgb.save(out_jpg, format='JPEG', quality=95, optimize=True)

print(f"Saved {out_png}: Size={im_rgb.size}, Mode={im_rgb.mode}, Bytes={os.path.getsize(out_png):,}")
print(f"Saved {out_jpg}: Size={im_rgb.size}, Mode={im_rgb.mode}, Bytes={os.path.getsize(out_jpg):,}")

os.remove(tmp_path)
`;

  execSync(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
  console.log('Done generating Chrome Web Store Marquee Promo Tile!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
