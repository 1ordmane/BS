/**
 * Regression test: working with project photos must not reload the page, jump the scroll
 * position or lose unsaved text in the project form.
 *
 *   npm run build && npm run test:e2e
 *
 * Uses the Chrome installed on this machine (CHROME_CHANNEL=chrome by default; set
 * CHROME_PATH to use a specific browser binary). Starts the built server with a temporary
 * data directory.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { makeImage } from '../helpers.ts';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-e2e-'));
const EMAIL = 'e2e@test.local';
const PASSWORD = 'e2e-test-password-1';

const port: number = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD, HOST: '127.0.0.1', PORT: String(port) };

const created = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/admin-create.ts', '--email', EMAIL], { cwd: root, env, encoding: 'utf8' });
assert.equal(created.status, 0, created.stderr);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server/entry.mjs'], { cwd: root, env, stdio: 'ignore' });

const files = await Promise.all(
  ['#b5482d', '#2d6bb5', '#3f9b4f'].map(async (color, i) => {
    const file = path.join(dataDir, `photo-${i + 1}.jpg`);
    fs.writeFileSync(file, await makeImage(1200, 800, 'jpeg', color));
    return file;
  }),
);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: process.env.CHROME_CHANNEL ?? 'chrome' });
let failed = false;

function step(name: string) {
  console.log(`• ${name}`);
}

try {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let navigations = 0;
  let navigationsBefore = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  step('log in and create a draft project');
  await page.goto(`${base}/admin/login`);
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${base}/admin`);
  await page.goto(`${base}/admin/projects/new`);
  await page.fill('#p-title', 'Проект для проверки галереи');
  await page.fill('#p-summary', 'Краткое описание.');
  await page.click('[data-action="save"]');
  await page.waitForURL(/\/admin\/projects\/\d+\?created=1/);
  const projectId = page.url().match(/projects\/(\d+)/)![1];

  step('type text without saving');
  const unsavedTitle = 'Несохранённое название — не должно пропасть';
  const unsavedDescription = 'Несохранённый текст описания.\n\nВторой абзац.';
  await page.fill('#p-title', unsavedTitle);
  await page.fill('#p-description', unsavedDescription);
  await page.waitForSelector('[data-save-state][data-state="dirty"]');

  const assertUntouched = async (label: string, expectedScroll: number) => {
    assert.equal(await page.inputValue('#p-title'), unsavedTitle, `${label}: title kept`);
    assert.equal(await page.inputValue('#p-description'), unsavedDescription, `${label}: description kept`);
    assert.equal(await page.getAttribute('[data-save-state]', 'data-state'), 'dirty', `${label}: still marked unsaved`);
    const scroll = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(scroll - expectedScroll) <= 4, `${label}: scroll stayed at ${expectedScroll}, now ${scroll}`);
    assert.equal(navigations, navigationsBefore, `${label}: page did not reload or navigate`);
  };

  step('scroll to the gallery');
  await page.locator('[data-gallery]').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  let scroll = await page.evaluate(() => window.scrollY);
  navigationsBefore = navigations;

  step('upload three photos');
  await page.setInputFiles('[data-file-input]', files);
  await page.waitForFunction(() => document.querySelectorAll('[data-gallery-list] .tile').length === 3, null, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-uploads] .upload').length === 0);
  // New tiles grow the page below the viewport top; the visible position must not jump.
  await assertUntouched('after upload', scroll);

  const order = () => page.$$eval('[data-gallery-list] .tile', (tiles) => tiles.map((t) => (t as HTMLElement).dataset.id!));
  const serverOrder = async () => {
    const response = await page.request.get(`${base}/api/admin/projects/${projectId}/images`);
    return ((await response.json()) as { images: { id: string }[] }).images.map((i) => i.id);
  };
  // Playwright scrolls a button into view (and again if the sticky save bar covers it) before
  // clicking. Centre the button first and measure then, so the check is about the page itself.
  const clickInPlace = async (selector: ReturnType<Page['locator']>) => {
    await selector.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    scroll = await page.evaluate(() => window.scrollY);
    await selector.click();
  };

  const initial = await order();
  assert.deepEqual(await serverOrder(), initial);

  step('reorder by drag and drop');
  scroll = await page.evaluate(() => window.scrollY);
  await page.locator('[data-gallery-list] .tile').nth(2).locator('.tile__image').dragTo(page.locator('[data-gallery-list] .tile').nth(0).locator('.tile__image'));
  const dragged = await order();
  assert.deepEqual(dragged, [initial[2], initial[0], initial[1]], 'third photo moved to the front');
  await page.waitForTimeout(900); // debounced save
  assert.deepEqual(await serverOrder(), dragged, 'order saved on the server');
  await assertUntouched('after drag and drop', scroll);

  step('reorder with the arrow button (keyboard path)');
  await clickInPlace(page.locator('[data-gallery-list] .tile').nth(0).locator('[data-move="1"]'));
  const moved = await order();
  assert.deepEqual(moved, [dragged[1], dragged[0], dragged[2]]);
  await page.waitForTimeout(900);
  assert.deepEqual(await serverOrder(), moved);
  await assertUntouched('after arrow move', scroll);

  step('make another photo the cover');
  await clickInPlace(page.locator('[data-gallery-list] .tile').nth(2).locator('[data-cover]'));
  await page.waitForSelector('[data-gallery-list] .tile:nth-child(3).is-cover');
  await assertUntouched('after cover change', scroll);

  step('delete a photo (with confirmation)');
  await clickInPlace(page.locator('[data-gallery-list] .tile').nth(1).locator('[data-delete]'));
  await page.click('dialog [value="confirm"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-gallery-list] .tile').length === 2);
  assert.deepEqual(await serverOrder(), [moved[0], moved[2]]);
  await assertUntouched('after delete', scroll);

  step('cancelling a delete keeps the photo');
  await page.locator('[data-gallery-list] .tile').nth(0).locator('[data-delete]').click();
  await page.click('dialog [value="cancel"]');
  assert.equal((await order()).length, 2);

  step('save the form: the typed text is what gets saved');
  await page.click('[data-action="save"]');
  await page.waitForSelector('[data-save-state][data-state="clean"]');
  const saved = await page.request.get(`${base}/admin/projects/${projectId}`);
  assert.match(await saved.text(), /Несохранённое название — не должно пропасть/);

  assert.deepEqual(errors, [], 'no script errors');
  console.log('\nOK: gallery operations keep the scroll position and unsaved form text, and persist the order.');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
}
