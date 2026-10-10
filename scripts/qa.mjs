import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseURL = 'http://127.0.0.1:4173';
const screenshotDir = path.resolve('screenshots');
const viewports = [320, 360, 390, 430, 768, 1024, 1440];
const failures = [];
const results = [];

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const width of viewports) {
  const height = width < 700 ? 900 : width < 1200 ? 900 : 1000;
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} — ${request.failure()?.errorText ?? 'failed'}`);
  });

  await page.goto(baseURL, { waitUntil: 'networkidle' });
  const revealItems = page.locator('.reveal');
  for (let index = 0; index < await revealItems.count(); index += 1) {
    await revealItems.nth(index).scrollIntoViewIfNeeded();
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  const brokenInternalLinks = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#"]')]
      .map((link) => link.getAttribute('href'))
      .filter((href) => href && href !== '#' && !document.querySelector(href)),
  );

  const images = await page.locator('img').evaluateAll((items) =>
    items.map((image) => ({ src: image.currentSrc || image.src, complete: image.complete, width: image.naturalWidth })),
  );
  const brokenImages = images.filter((image) => !image.complete || image.width === 0);

  if (width < 900) {
    const toggle = page.locator('[data-menu-toggle]');
    await toggle.click();
    await page.waitForTimeout(250);
    const expanded = await toggle.getAttribute('aria-expanded');
    const navVisible = await page.locator('[data-menu]').isVisible();
    if (expanded !== 'true' || !navVisible) {
      const menuState = await page.locator('[data-menu]').evaluate((element) => {
        const styles = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          display: styles.display,
          visibility: styles.visibility,
          opacity: styles.opacity,
          width: rect.width,
          height: rect.height,
        };
      });
      failures.push(`${width}px: mobile menu did not open (${JSON.stringify(menuState)})`);
    }
    await toggle.click();
    await page.waitForTimeout(180);
  }

  if (overflow.scrollWidth > overflow.clientWidth) {
    failures.push(`${width}px: horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`);
  }
  if (brokenInternalLinks.length) failures.push(`${width}px: broken anchors ${brokenInternalLinks.join(', ')}`);
  if (brokenImages.length) failures.push(`${width}px: ${brokenImages.length} broken image(s)`);
  if (consoleErrors.length) failures.push(`${width}px: console errors: ${consoleErrors.join(' | ')}`);
  if (pageErrors.length) failures.push(`${width}px: page errors: ${pageErrors.join(' | ')}`);
  if (failedRequests.length) failures.push(`${width}px: failed requests: ${failedRequests.join(' | ')}`);

  if (width === 390) {
    await page.screenshot({ path: path.join(screenshotDir, 'home-390.png'), fullPage: true });
    await page.evaluate(() => {
      document.activeElement?.blur();
      document.querySelector('[data-header]')?.setAttribute('hidden', '');
      document.querySelector('.skip-link')?.setAttribute('hidden', '');
    });
    await page.locator('#memberships').screenshot({ path: path.join(screenshotDir, 'pricing-390.png') });
    await page.evaluate(() => {
      document.querySelector('[data-header]')?.removeAttribute('hidden');
      document.querySelector('.skip-link')?.removeAttribute('hidden');
    });
  }
  if (width === 1440) {
    await page.screenshot({ path: path.join(screenshotDir, 'home-1440.png'), fullPage: true });
    await page.evaluate(() => {
      document.activeElement?.blur();
      document.querySelector('[data-header]')?.setAttribute('hidden', '');
      document.querySelector('.skip-link')?.setAttribute('hidden', '');
    });
    await page.locator('#memberships').screenshot({ path: path.join(screenshotDir, 'pricing-1440.png') });
  }

  results.push({ width, height, overflow, images: images.length, status: 'ok' });
  await context.close();
}

await browser.close();

console.log(JSON.stringify({ results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
