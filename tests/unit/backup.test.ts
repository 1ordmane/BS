import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeImage, sampleProject, useTempData } from '../helpers.ts';

const dir = useTempData();
const backup = await import('../../src/server/backup.ts');
const projects = await import('../../src/server/projects.ts');
const images = await import('../../src/server/images.ts');
const { closeDb, getDb, schemaVersion } = await import('../../src/server/db.ts');
const { migrations } = await import('../../src/server/migrations.ts');

test('database is created at the latest schema and survives a reopen', () => {
  assert.equal(schemaVersion(), migrations.length);
  const project = projects.createProject(sampleProject({ slug: 'persisted' }), null);
  closeDb();
  getDb();
  assert.equal(projects.getProject(project.id)?.slug, 'persisted');
});

test('backup and restore round trip, including images', async () => {
  const project = projects.getProject(1)!;
  const image = await images.addProjectImage(project.id, { buffer: await makeImage(), originalName: 'b.jpg' });
  const made = backup.createBackup('test');
  assert.ok(fs.existsSync(path.join(dir, 'backups', made.name, 'site.db')));
  assert.ok(fs.existsSync(path.join(dir, 'backups', made.name, 'media', image.id, 'og.jpg')));

  projects.deleteProject(project.id, null);
  assert.equal(projects.getProject(project.id), undefined);

  const aside = backup.restoreBackup(made.name);
  assert.equal(projects.getProject(project.id)?.slug, 'persisted');
  assert.ok(fs.existsSync(path.join(dir, 'media', image.id, 'og.jpg')));
  assert.ok(fs.existsSync(path.join(aside, 'site.db')), 'replaced data kept aside');
});

test('a database newer than the code is refused', async () => {
  closeDb();
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path.join(dir, 'site.db'));
  raw.exec(`PRAGMA user_version = ${migrations.length + 1}`);
  raw.close();
  assert.throws(() => getDb(), /newer than this code/);
});
