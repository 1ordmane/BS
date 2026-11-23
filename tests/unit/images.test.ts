import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeImage, sampleProject, useTempData } from '../helpers.ts';

const dir = useTempData();
const images = await import('../../src/server/images.ts');
const projects = await import('../../src/server/projects.ts');
const { getDb, one } = await import('../../src/server/db.ts');
const { UserError } = await import('../../src/server/errors.ts');

const project = projects.createProject(sampleProject(), null);

test('rejects files that are not images, too small or unsupported', async () => {
  await assert.rejects(images.addProjectImage(project.id, { buffer: Buffer.from('<?php echo 1; ?>'), originalName: 'x.jpg' }), UserError);
  await assert.rejects(images.addProjectImage(project.id, { buffer: await makeImage(100, 100), originalName: 'tiny.jpg' }), /слишком маленькое/);
  const gif = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
  await assert.rejects(images.addProjectImage(project.id, { buffer: gif, originalName: 'a.gif' }), UserError);
  assert.equal(images.listProjectImages(project.id).length, 0, 'nothing stored');
});

test('stores variants under a random name and makes the first image the cover', async () => {
  const row = await images.addProjectImage(project.id, { buffer: await makeImage(1600, 1000), originalName: '../../etc/passwd.jpg', alt: 'Фасад' });
  assert.match(row.id, /^[a-f0-9]{24}$/);
  assert.equal(row.original_name, 'passwd.jpg', 'path removed from the stored name');
  const files = fs.readdirSync(path.join(dir, 'media', row.id)).sort();
  assert.deepEqual(files, ['og.jpg', 'thumb.webp', 'w1440.webp', 'w1600.webp', 'w480.webp', 'w960.webp']);
  assert.equal(projects.getProject(project.id)!.cover_image_id, row.id);
  const view = images.toView(row);
  assert.ok(view.srcset.includes('w480.webp 480w'));
});

test('reorder accepts exactly the project images, in any order', async () => {
  await images.addProjectImage(project.id, { buffer: await makeImage(800, 600, 'png'), originalName: 'b.png' });
  await images.addProjectImage(project.id, { buffer: await makeImage(800, 600, 'webp'), originalName: 'c.webp' });
  const ids = images.listProjectImages(project.id).map((i) => i.id);
  const reversed = [...ids].reverse();
  assert.deepEqual(images.reorderProjectImages(project.id, reversed).map((i) => i.id), reversed);
  assert.deepEqual(images.listProjectImages(project.id).map((i) => i.id), reversed, 'order persisted');
  assert.throws(() => images.reorderProjectImages(project.id, reversed.slice(1)), /изменилась/);
  assert.throws(() => images.reorderProjectImages(project.id, [reversed[0], reversed[0], reversed[1]]), /изменилась/);
  assert.throws(() => images.reorderProjectImages(project.id, ['not-an-id']));
});

test('cover must belong to the same project (enforced by the database too)', async () => {
  const other = projects.createProject(sampleProject({ title: 'Другой', slug: 'other' }), null);
  const foreign = await images.addProjectImage(other.id, { buffer: await makeImage(), originalName: 'f.jpg' });
  assert.throws(() => images.setProjectCover(project.id, foreign.id));
  assert.throws(() => getDb().prepare('UPDATE projects SET cover_image_id = ? WHERE id = ?').run(foreign.id, project.id), /cover image must belong/);
});

test('deleting the cover removes files, keeps order contiguous and picks a new cover', () => {
  const before = images.listProjectImages(project.id);
  const cover = projects.getProject(project.id)!.cover_image_id!;
  images.deleteImage(cover);
  assert.equal(fs.existsSync(path.join(dir, 'media', cover)), false);
  const after = images.listProjectImages(project.id);
  assert.equal(after.length, before.length - 1);
  assert.deepEqual(after.map((i) => i.position), after.map((_, index) => index));
  assert.equal(projects.getProject(project.id)!.cover_image_id, after[0]!.id);
});

test('a library image in use cannot be deleted', async () => {
  const media = await images.addMediaImage({ buffer: await makeImage(), originalName: 'hero.jpg' });
  const services = await import('../../src/server/services.ts');
  services.createService({ title: 'Свет', summary: 'Освещение', image_id: media.id, published: true }, null);
  assert.throws(() => images.deleteImage(media.id), /используется/);
  assert.ok(one('SELECT id FROM images WHERE id = ?', media.id));
});

test('orphan media folders are swept, recent ones are left alone', () => {
  const orphan = path.join(dir, 'media', 'aaaaaaaaaaaaaaaaaaaaaaaa');
  fs.mkdirSync(orphan, { recursive: true });
  assert.equal(images.sweepOrphanMedia(), 0, 'recent folder kept (may be an upload in progress)');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(orphan, old, old);
  assert.equal(images.sweepOrphanMedia(), 1);
  assert.equal(fs.existsSync(orphan), false);
});
