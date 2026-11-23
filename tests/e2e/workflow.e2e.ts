/**
 * Full workflow through the admin interface against the built server, checking what a visitor
 * then sees: homepage draft → preview → publish, portfolio selection order, a new approach
 * stage, hiding a service, company contacts, and an inquiry sent through the public form.
 *
 *   npm run build && npm run test:e2e
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright-core';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-flow-'));
const port: number = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, DATA_DIR: dataDir, ADMIN_PASSWORD: 'flow-test-password', HOST: '127.0.0.1', PORT: String(port) };
spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/admin-create.ts', '--email', 'flow@test.local'], { env });
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server/entry.mjs'], { env, stdio: 'ignore' });
for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: process.env.CHROME_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
const visitor = await (await browser.newContext()).newPage();
const publicHtml = async (p = '/') => { await visitor.goto(base + p); return visitor.content(); };
try {
  await page.goto(base + '/admin/login'); await page.fill('#login-email', 'flow@test.local'); await page.fill('#login-password', 'flow-test-password'); await page.click('button[type=submit]'); await page.waitForURL(base + '/admin');

  console.log('• homepage: edit subtitle, save draft');
  await page.goto(base + '/admin/homepage');
  await page.fill('#h-text', 'Подзаголовок из проверки через интерфейс.');
  await page.click('[data-doc-save]'); await page.waitForSelector('[data-pending-badge].badge--draft');
  assert.doesNotMatch(await publicHtml(), /из проверки через интерфейс/, 'draft not public');
  const preview = await page.request.get(base + '/admin/preview'); assert.match(await preview.text(), /из проверки через интерфейс/);

  console.log('• homepage: reorder and remove from the selection, publish');
  const titles = () => page.$$eval('[data-pick-list] [data-pick-title]', els => els.map(e => e.textContent));
  const before = await titles();
  await page.locator('[data-pick-list] [data-pick]').nth(0).locator('[data-pick-down]').click();
  await page.locator('[data-pick-list] [data-pick]').last().locator('[data-pick-remove]').click();
  const after = await titles();
  assert.deepEqual(after, [before[1], before[0], ...before.slice(2, -1)]);
  await page.click('[data-doc-publish]'); await page.click('dialog [value="confirm"]');
  await page.waitForSelector('.toast:has-text("Опубликовано")');
  const home = await publicHtml();
  assert.match(home, /из проверки через интерфейс/);
  const order = [...home.matchAll(/work__title[^>]*>([^<]+)</g)].map(m => m[1]!.replace(/&nbsp;/g, ' '));
  // The homepage shows the first three of the selection, in order.
  assert.deepEqual(order, after.slice(0, 3).map(t => t!.replace(/\u00a0/g, ' ')), 'homepage selection order');

  console.log('• about: add a sixth stage, publish');
  await page.goto(base + '/admin/about');
  await page.click('[data-repeater="approach.stages"] [data-repeat-add]');
  const last = page.locator('[data-repeater="approach.stages"] [data-repeat-item]').last();
  await last.locator('input').nth(0).fill('Поддержка');
  await last.locator('input').nth(1).fill('Хранение конструкций между выставками.');
  await page.click('[data-doc-publish]'); await page.click('dialog [value="confirm"]');
  await page.waitForSelector('.toast:has-text("Опубликовано")');
  assert.match(await publicHtml(), /Хранение конструкций между выставками/);

  console.log('• services: hide one');
  await page.goto(base + '/admin/services');
  const serviceTitle = await page.locator('[data-services] .pick__title').first().textContent();
  await page.locator('[data-services] [data-toggle]').first().uncheck(); await page.waitForTimeout(500);
  assert.doesNotMatch(await publicHtml(), new RegExp(`service__title[^>]*>${serviceTitle}<`));

  console.log('• settings: phone, publish → footer link');
  await page.goto(base + '/admin/settings');
  await page.fill('#co-phone', '+7 (495) 123-45-67');
  await page.click('[data-doc-publish]'); await page.click('dialog [value="confirm"]');
  await page.waitForSelector('.toast:has-text("Опубликовано")');
  assert.match(await publicHtml(), /href="tel:\+74951234567"/);

  console.log('• visitor sends an inquiry through the form');
  await visitor.goto(base + '/#contact');
  await visitor.fill('#inquiry-name', 'Мария'); await visitor.fill('#inquiry-email', 'maria@example.ru');
  await visitor.fill('#inquiry-message', 'Нужен стенд 50 м² для выставки в мае.');
  await visitor.check('input[name="consent"]', { force: true });
  await visitor.click('[data-submit]');
  await visitor.waitForSelector('[data-status-box][data-state="success"]');
  await page.goto(base + '/admin/requests'); assert.match(await page.content(), /Мария/);
  await page.click('text=Мария'); await page.selectOption('#rq-status', 'in_progress'); await page.fill('#rq-notes', 'Позвонить');
  await page.click('[data-request-form] button[type=submit]'); await page.waitForTimeout(400);
  await page.reload(); assert.equal(await page.inputValue('#rq-notes'), 'Позвонить');

  console.log('• media library page loads');
  await page.goto(base + '/admin/media'); assert.ok(await page.locator('[data-library-list] .tile').count() > 0);

  assert.deepEqual(errors, []);
  console.log('OK: full admin → public workflow');
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await browser.close(); server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); }
