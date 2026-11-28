#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { execFileSync } = require('child_process');

async function main() {
  console.log('Launching Puppeteer...');
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
  };
  if (fs.existsSync(chromePath)) {
    launchOpts.executablePath = chromePath;
  }
  const browser = await puppeteer.launch(launchOpts);

  const tmpPng = path.resolve(__dirname, 'tmp_marquee.png');
  const outDir = path.resolve(__dirname, '../store_assets');
  try {
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
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`Rendered supersampled screenshot to ${tmpPng}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Process with Python PIL to guarantee 1400x560 24-bit RGB (no alpha)
  const pyScript = `
import os
import sys
from PIL import Image

tmp_path, out_dir = sys.argv[1], sys.argv[2]
with Image.open(tmp_path) as im:
    im_resized = im.resize((1400, 560), Image.Resampling.LANCZOS)
    im_rgb = im_resized.convert('RGB')

out_png = os.path.join(out_dir, 'marquee_promo_1400x560.png')
out_jpg = os.path.join(out_dir, 'marquee_promo_1400x560.jpg')

im_rgb.save(out_png, format='PNG', compress_level=0)
im_rgb.save(out_jpg, format='JPEG', quality=98, optimize=True)

print(f"Saved {out_png}: Size={im_rgb.size}, Mode={im_rgb.mode}, Bytes={os.path.getsize(out_png):,}")
print(f"Saved {out_jpg}: Size={im_rgb.size}, Mode={im_rgb.mode}, Bytes={os.path.getsize(out_jpg):,}")
`;

  try {
    execFileSync('python3', ['-c', pyScript, tmpPng, outDir], { stdio: 'inherit' });
  } finally {
    if (fs.existsSync(tmpPng)) {
      fs.unlinkSync(tmpPng);
    }
  }
  console.log('Done generating Chrome Web Store Marquee Promo Tile!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
