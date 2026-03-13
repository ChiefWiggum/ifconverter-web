/**
 * Visual tests: render album pages and compare to iFolor reference screenshots.
 * Target: >=95% match (max 5% pixel diff).
 *
 * Reference images live under:
 * - tests/fixtures/cook-islands/
 * - tests/fixtures/india-china/
 *
 * Run: npm run test:visual
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUTPUT_DIR = path.join(__dirname, 'output', 'visual-comparisons');

const COMPARE_WIDTH = 800;
/** Target >=95% match: max 5% of pixels may differ. */
const MAX_DIFF_RATIO = 0.05;
const PIXEL_THRESHOLD = 0.2;
const CENTER_STRIP_HALF = 0.02;
const COVER_VIEWER_MASKS = [
  // Small round viewer marker centered on the spine.
  { x: 0.488, y: 0.455, width: 0.026, height: 0.055 },
  // Red ifolor logo / badge near the bottom inner edge of the back cover.
  { x: 0.425, y: 0.915, width: 0.085, height: 0.06 }
];

const ALBUM_CASES = [
  {
    key: 'cook-islands',
    title: 'Cook Islands 2014',
    albumPath: path.join('d:', 'Documents', 'ifolor', 'Photobooks', 'Cook Islands 2014'),
    fixtureDir: path.join(FIXTURES_DIR, 'cook-islands'),
    cases: [
      { label: 'pages-cover', indices: [0], referenceFile: 'reference-pages-cover.png', maskCenterStrip: false, maskRects: COVER_VIEWER_MASKS },
      { label: 'pages-1', indices: [1], referenceFile: 'reference-pages-1.png' },
      { label: 'pages-10-11', indices: [6], referenceFile: 'reference-pages-10-11.png' },
      { label: 'pages-14-15', indices: [8], referenceFile: 'reference-pages-14-15.png' },
    ]
  },
  {
    key: 'india-china',
    title: 'India/China',
    albumPath: path.join('d:', 'Documents', 'ifolor', 'Photobooks', 'Indien_China'),
    fixtureDir: path.join(FIXTURES_DIR, 'india-china'),
    cases: [
      { label: 'pages-cover', indices: [0], referenceFile: 'reference-pages-cover.png', maskCenterStrip: false, maskRects: COVER_VIEWER_MASKS },
      { label: 'pages-10-11', indices: [6], referenceFile: 'reference-pages-10-11.png' },
      { label: 'pages-16-17', indices: [9], referenceFile: 'reference-pages-16-17.png' },
      { label: 'pages-20-21', indices: [11], referenceFile: 'reference-pages-20-21.png' },
      { label: 'pages-22-23', indices: [12], referenceFile: 'reference-pages-22-23.png' },
      { label: 'pages-46-47', indices: [24], referenceFile: 'reference-pages-46-47.png' },
      { label: 'pages-52-53', indices: [27], referenceFile: 'reference-pages-52-53.png' },
      { label: 'pages-58-59', indices: [30], referenceFile: 'reference-pages-58-59.png' },
      { label: 'pages-60', indices: [31], referenceFile: 'reference-pages-60.png', maskCenterStrip: false },
    ]
  }
];

function maskCenterStrip(buf, width, height) {
  const left = Math.floor(width * (0.5 - CENTER_STRIP_HALF));
  const right = Math.ceil(width * (0.5 + CENTER_STRIP_HALF));
  for (let y = 0; y < height; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4;
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = 255;
    }
  }
}

function maskRects(buf, width, height, rects = []) {
  for (const rect of rects) {
    const left = Math.max(0, Math.floor(rect.x * width));
    const top = Math.max(0, Math.floor(rect.y * height));
    const right = Math.min(width, Math.ceil((rect.x + rect.width) * width));
    const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * height));
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const i = (y * width + x) * 4;
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
        buf[i + 3] = 255;
      }
    }
  }
}

function getFileInputs(dirPath) {
  return fs.existsSync(dirPath)
    ? fs.readdirSync(dirPath).map((n) => path.join(dirPath, n)).filter((p) => fs.statSync(p).isFile())
    : [];
}

async function loadAlbumAndRenderSelection(page, albumPath, indices) {
  const ippPath = path.join(albumPath, 'Project.ipp');
  const photosDir = path.join(albumPath, 'Photos');
  const textsDir = path.join(albumPath, 'Texts');
  const photoPaths = getFileInputs(photosDir);
  const textPaths = getFileInputs(textsDir);

  await page.goto('http://localhost:3000');
  await page.locator('#ippFile').setInputFiles(ippPath);
  await page.waitForSelector('#projectInfo.visible', { timeout: 15000 });
  await page.locator('#scaleSelect').selectOption('1');
  if (photoPaths.length) await page.locator('#photosInput').setInputFiles(photoPaths);
  if (textPaths.length) await page.locator('#textsInput').setInputFiles(textPaths);

  await page.locator('#renderSomeBtn').click();
  await page.locator('.page-select-none').click();
  for (const i of indices) {
    await page.locator(`.page-select-item input[data-index="${i}"]`).check();
  }
  await page.locator('.page-select-render').click();

  await page.waitForSelector('.page-card', { timeout: 60000 });
  await expect(page.locator('.progress-text')).toContainText('Complete!', { timeout: 60000 });

  const screenshot = await page.evaluate(async () => {
    const cards = document.querySelectorAll('#pagesContainer .page-card');
    const c1 = cards[0]?.querySelector('.page-canvas-wrapper canvas');
    const c2 = cards[1]?.querySelector('.page-canvas-wrapper canvas');
    if (!c1) return null;
    if (!c2) return c1.toDataURL('image/png');
    const w1 = c1.width;
    const h1 = c1.height;
    const w2 = c2.width;
    const h2 = c2.height;
    const out = document.createElement('canvas');
    out.width = w1 + w2;
    out.height = Math.max(h1, h2);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c1, 0, 0);
    ctx.drawImage(c2, w1, 0);
    return out.toDataURL('image/png');
  });

  if (!screenshot) throw new Error('Could not get canvas composite');
  return Buffer.from(screenshot.replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

async function compareToReference(screenshotBuf, referencePath, outputDir, outputLabel, maskCenter = true, rectMasks = []) {
  const refMeta = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const refW = refMeta.info.width;
  const refH = refMeta.info.height;
  const scale = COMPARE_WIDTH / refW;
  const compareW = COMPARE_WIDTH;
  const compareH = Math.round(refH * scale);

  let actual = await sharp(screenshotBuf).resize(compareW, compareH).ensureAlpha().raw().toBuffer();
  let expected = await sharp(referencePath).resize(compareW, compareH).ensureAlpha().raw().toBuffer();
  if (maskCenter) {
    maskCenterStrip(actual, compareW, compareH);
    maskCenterStrip(expected, compareW, compareH);
  }
  if (rectMasks.length) {
    maskRects(actual, compareW, compareH, rectMasks);
    maskRects(expected, compareW, compareH, rectMasks);
  }

  const diffPixels = pixelmatch(actual, expected, null, compareW, compareH, { threshold: PIXEL_THRESHOLD });
  const totalPixels = compareW * compareH;
  const diffRatio = diffPixels / totalPixels;
  const matchPct = (1 - diffRatio) * 100;
  await fs.promises.mkdir(outputDir, { recursive: true });
  const diffPath = path.join(outputDir, `diff-${outputLabel}.png`);
  const diffImg = Buffer.alloc(compareW * compareH * 4);

  pixelmatch(actual, expected, diffImg, compareW, compareH, { threshold: PIXEL_THRESHOLD });
  await sharp(diffImg, { raw: { width: compareW, height: compareH, channels: 4 } })
    .png()
    .toFile(diffPath);

  if (diffRatio > MAX_DIFF_RATIO) {
    throw new Error(
      `Match ${matchPct.toFixed(1)}% (need ≥95%). Diff: ${(diffRatio * 100).toFixed(2)}%. See: ${diffPath}`
    );
  }
  return matchPct;
}

for (const album of ALBUM_CASES) {
  test.describe(`${album.title} visual comparisons`, () => {
    test.beforeEach(async () => {
      if (!fs.existsSync(album.albumPath)) {
        test.skip(true, `Album not found: ${album.albumPath}`);
      }
      if (!fs.existsSync(path.join(album.albumPath, 'Project.ipp'))) {
        test.skip(true, `Project.ipp not found in ${album.albumPath}`);
      }
    });

    for (const testCase of album.cases) {
      test(`${testCase.label} match reference >=95%`, async ({ page }) => {
        test.setTimeout(120000);
        const refPath = path.join(album.fixtureDir, testCase.referenceFile);
        if (!fs.existsSync(refPath)) {
          test.skip(true, `Missing ${refPath}`);
          return;
        }

        const screenshotBuf = await loadAlbumAndRenderSelection(page, album.albumPath, testCase.indices);
        const albumOutputDir = path.join(OUTPUT_DIR, album.key);
        await fs.promises.mkdir(albumOutputDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(albumOutputDir, `${testCase.label}.png`),
          screenshotBuf
        );

        const matchPct = await compareToReference(
          screenshotBuf,
          refPath,
          albumOutputDir,
          testCase.label,
          testCase.maskCenterStrip !== false,
          testCase.maskRects || []
        );

        console.log(`[${album.title}] ${testCase.label}: ${matchPct.toFixed(2)}% match`);
      });
    }
  });
}
