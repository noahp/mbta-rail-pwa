// Generate mobile screenshots of the running dev server.
// Usage: yarn dev (in another terminal), then: node scripts/screenshots.mjs
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const URL = process.env.SCREENSHOT_URL ?? 'http://localhost:5174';
const OUT_DIR = 'screenshots';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';

// Pixel 7 viewport (412 x 915) with mobile DPR 2.625 — matches a real device
const viewport = {
  width: 412,
  height: 915,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const userAgent =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

await mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox'],
});

async function shoot(name, prep) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setUserAgent(userAgent);
  if (prep) await prep(page);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
  // Give predictions/schedules a moment to populate
  await new Promise((r) => setTimeout(r, 2500));
  const buffer = await page.screenshot({ type: 'png' });
  await writeFile(join(OUT_DIR, `${name}.png`), buffer);
  console.log(`  → ${name}.png`);
  await page.close();
}

console.log('Capturing screenshots…');

await shoot('routes');

await shoot('trains', async (page) => {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem(
      'mbta-rail-pwa-v1',
      JSON.stringify({
        apiKey: '',
        favoriteRoutes: ['CR-Providence', 'CR-Framingham'],
        favoriteStops: { 'CR-Providence': ['place-sstat', 'place-NEC-2139'] },
        refreshInterval: 10,
      }),
    );
  });
});

await browser.close();
console.log('Done.');
