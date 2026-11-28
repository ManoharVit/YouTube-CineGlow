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

  const ffmpegBin = process.env.FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
  // Spawn ffmpeg to read raw PNG stream from stdin and encode pristine Full HD H.264 MP4 with >= 2.5 Mbps bitrate
  const ffmpeg = spawn(ffmpegBin, [
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
    const str = chunk.toString();
    if (str.includes('Error') || str.includes('fatal')) {
      console.error('[ffmpeg error]:', str);
    }
  });

  let ffmpegExited = false;
  const ffmpegPromise = new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      ffmpegExited = true;
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', (err) => {
      ffmpegExited = true;
      reject(err);
    });
    ffmpeg.stdin.on('error', (err) => {
      ffmpegExited = true;
      reject(err);
    });
  });

  console.log('Launching Headless Chrome for frame rendering...');
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOpts = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--hide-scrollbars'
    ]
  };
  if (fs.existsSync(chromePath)) {
    launchOpts.executablePath = chromePath;
  }
  const browser = await puppeteer.launch(launchOpts);

  const startTime = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

    console.log(`Loading showcase stage: ${HTML_PAGE}...`);
    await page.goto(HTML_PAGE, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 500));

    console.log('Rendering and encoding frames to MP4...');

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      if (ffmpegExited) {
        await ffmpegPromise;
      }
      const t = i / FPS;

      // Advance deterministic animation timeline
      await page.evaluate((time) => window.seekToTime(time), t);

      // Capture lossless PNG frame buffer
      const frameBuffer = await page.screenshot({
        type: 'png'
      });

      // Write to ffmpeg stdin with backpressure handling and early-exit race protection
      const canContinue = ffmpeg.stdin.write(frameBuffer);
      if (!canContinue) {
        await Promise.race([
          new Promise((resolve) => ffmpeg.stdin.once('drain', resolve)),
          ffmpegPromise
        ]);
      }

      if (i % 150 === 0 || i === TOTAL_FRAMES - 1) {
        const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
        const progress = (((i + 1) / TOTAL_FRAMES) * 100).toFixed(1);
        const elapsed = elapsedSec.toFixed(1);
        const fpsRender = ((i + 1) / elapsedSec).toFixed(1);
        console.log(`[Frame ${String(i + 1).padStart(4, ' ')}/${TOTAL_FRAMES}] ${progress}% — Timeline: ${t.toFixed(1)}s / ${DURATION_SEC}s — Render Speed: ${fpsRender} fps (${elapsed}s elapsed)`);
      }
    }

    console.log('Finalizing video stream in ffmpeg...');
    ffmpeg.stdin.end();
    await ffmpegPromise;
  } finally {
    await browser.close().catch(() => {});
  }

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
