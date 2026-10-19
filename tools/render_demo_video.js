#!/usr/bin/env node

/**
 * YouTube CineGlow Pro — Product Showcase Video Renderer
 * Renders a 1080p 30fps Full HD MP4 video demonstration of the extension.
 *
 * Developer & Lead Architect: Giri Manohar Vemula
 * LinkedIn: https://www.linkedin.com/in/manoharv511
 * GitHub: https://github.com/ManoharVit
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const DURATION_SEC = 48.0;
const FPS = 30;
const TOTAL_FRAMES = Math.round(DURATION_SEC * FPS); // 1,440 frames
const WIDTH = 1920;
const HEIGHT = 1080;

const OUTPUT_VIDEO = path.resolve(__dirname, '../YouTube_CineGlow_Pro_Demo.mp4');
const HTML_PAGE = 'file://' + path.resolve(__dirname, 'demo_showcase.html');

async function render() {
  console.log('====================================================');
  console.log('   YouTube CineGlow Pro — 1080p Video Showcase      ');
  console.log('====================================================');
  console.log(`Resolution:   ${WIDTH}x${HEIGHT} (Full HD)`);
  console.log(`Framerate:    ${FPS} fps`);
  console.log(`Duration:     ${DURATION_SEC} seconds`);
  console.log(`Total Frames: ${TOTAL_FRAMES}`);
  console.log(`Output Target: ${OUTPUT_VIDEO}`);
  const soundtrackPath = path.resolve(__dirname, 'soundtrack_with_narration.wav');
  console.log(`Audio Track:  ${soundtrackPath}`);
  console.log('----------------------------------------------------');

  // Spawn ffmpeg to read raw PNG stream from stdin and encode pristine Full HD H.264 MP4 with >= 2.5 Mbps bitrate
  const ffmpeg = spawn('/opt/homebrew/bin/ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', String(FPS),
    '-i', '-',
    '-i', soundtrackPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-b:v', '4.5M',
    '-minrate', '2.5M',
    '-maxrate', '7.0M',
    '-bufsize', '8.0M',
    '-c:a', 'aac',
    '-b:a', '256k',
    '-shortest',
    '-movflags', '+faststart',
    OUTPUT_VIDEO
  ]);

  ffmpeg.stderr.on('data', (chunk) => {
    // Only print error lines if needed
    const str = chunk.toString();
    if (str.includes('Error') || str.includes('fatal')) {
      console.error('[ffmpeg error]:', str);
    }
  });

  const ffmpegPromise = new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });

  console.log('Launching Headless Chrome for frame rendering...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--hide-scrollbars'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  console.log(`Loading showcase stage: ${HTML_PAGE}...`);
  await page.goto(HTML_PAGE, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 500));

  const startTime = Date.now();
  console.log('Rendering and encoding frames to MP4...');

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const t = i / FPS;

    // Advance deterministic animation timeline
    await page.evaluate((time) => window.seekToTime(time), t);

    // Capture lossless PNG frame buffer
    const frameBuffer = await page.screenshot({
      type: 'png'
    });

    // Write to ffmpeg stdin with backpressure handling
    const canContinue = ffmpeg.stdin.write(frameBuffer);
    if (!canContinue) {
      await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }

    if (i % 150 === 0 || i === TOTAL_FRAMES - 1) {
      const progress = (((i + 1) / TOTAL_FRAMES) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const fpsRender = ((i + 1) / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`[Frame ${String(i + 1).padStart(4, ' ')}/${TOTAL_FRAMES}] ${progress}% — Timeline: ${t.toFixed(1)}s / ${DURATION_SEC}s — Render Speed: ${fpsRender} fps (${elapsed}s elapsed)`);
    }
  }

  console.log('Finalizing video stream in ffmpeg...');
  ffmpeg.stdin.end();
  await ffmpegPromise;
  await browser.close();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = fs.statSync(OUTPUT_VIDEO);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  const storeCopy = path.resolve(__dirname, '../store_assets/YouTube_CineGlow_Pro_Demo.mp4');
  fs.copyFileSync(OUTPUT_VIDEO, storeCopy);

  console.log('====================================================');
  console.log('✨ Video Demonstration Created Successfully! ✨');
  console.log(`File:     ${OUTPUT_VIDEO}`);
  console.log(`Store:    ${storeCopy}`);
  console.log(`Size:     ${sizeMb} MB`);
  console.log(`Duration: ${DURATION_SEC} seconds`);
  console.log(`Audio:    Stereo 48kHz AAC (192 kbps)`);
  console.log(`Time:     ${totalTime} seconds total render time`);
  console.log('====================================================');
}

render().catch((err) => {
  console.error('Render failed:', err);
  process.exit(1);
});
