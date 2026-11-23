import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeImage, sampleProject, useTempData } from '../helpers.ts';

const dir = useTempData();
const projects = await import('../../src/server/projects.ts');
const images = await import('../../src/server/images.ts');
const content = await import('../../src/server/content.ts');
const { all, one } = await import('../../src/server/db.ts');
const { ConflictError, ValidationError, UserError } = await import('../../src/server/errors.ts');

test('validation: title required, slug format, unknown category', () => {
  assert.throws(() => projects.createProject({ title: '', category: 'island' }, null), (e: unknown) => e instanceof ValidationError && 'title' in e.fields);
  assert.throws(() => projects.createProject(sampleProject({ slug: 'Bad Slug!' }), null), (e: unknown) => e instanceof ValidationError && 'slug' in e.fields);
  assert.throws(() => projects.createProject(sampleProject({ category: 'spaceship' }), null), (e: unknown) => e instanceof ValidationError && 'category' in e.fields);
  assert.throws(() => projects.createProject(sampleProject({ title: 'x'.repeat(141) }), null), ValidationError);
});

test('slug is generated from a Russian title and must be unique', () => {
  const project = projects.createProject(sampleProject({ title: 'Стенд для «Иннопрома»' }), null);
  assert.equal(project.slug, 'stend-dlya-innoproma');
  assert.equal(project.status, 'draft');
  assert.throws(
    () => projects.createProject(sampleProject({ title: 'Другой', slug: 'stend-dlya-innoproma' }), null),
    (e: unknown) => e instanceof ValidationError && /занят/.test(e.fields.slug ?? ''),
  );
});

test('input is cleaned: control characters removed, single-line fields joined', () => {
  const project = projects.createProject(sampleProject({ title: 'Стенд\u0000 с\nпереносом', slug: 'clean' }), null);
  assert.equal(project.title, 'Стенд с переносом');
});

test('saving with an outdated version is refused instead of overwriting', () => {
  const project = projects.createProject(sampleProject({ slug: 'versioned' }), null);
  const saved = projects.updateProject(project.id, { ...sampleProject({ slug: 'versioned' }), title: 'Первая правка' }, project.version, null);
  assert.equal(saved.version, project.version + 1);
  assert.throws(() => projects.updateProject(project.id, { ...sampleProject({ slug: 'versioned' }), title: 'Старая вкладка' }, project.version, null), ConflictError);
  assert.equal(projects.getProject(project.id)!.title, 'Первая правка');
});

test('every save keeps the previous texts as a revision that can be restored', () => {
  const project = projects.createProject(sampleProject({ slug: 'revs', title: 'Версия 1' }), null);
  const v2 = projects.updateProject(project.id, sampleProject({ slug: 'revs', title: 'Версия 2' }), project.version, null);
  projects.updateProject(project.id, sampleProject({ slug: 'revs', title: 'Версия 3' }), v2.version, null);
  const revisions = projects.listRevisions(project.id);
  assert.deepEqual(revisions.map((r) => r.title), ['Версия 2', 'Версия 1']);
  const restored = projects.restoreRevision(project.id, revisions[1]!.id, null);
  assert.equal(restored.title, 'Версия 1');
  assert.equal(projects.listRevisions(project.id)[0]!.title, 'Версия 3', 'the replaced texts are kept too');
});

test('publishing needs a cover image; unpublished projects are not public', async () => {
  const project = projects.createProject(sampleProject({ slug: 'publish-me' }), null);
  assert.throws(() => projects.setStatus(project.id, 'published', null), (e: unknown) => e instanceof UserError && /обложки/.test(e.message));
  await images.addProjectImage(project.id, { buffer: await makeImage(), originalName: 'cover.jpg' });
  const published = projects.setStatus(project.id, 'published', null);
  assert.equal(published.status, 'published');
  assert.ok(published.published_at);
  assert.equal(projects.findPublishedBySlug('publish-me').project?.id, project.id);
  projects.setStatus(project.id, 'draft', null);
  assert.deepEqual(projects.findPublishedBySlug('publish-me'), {});
  assert.ok(!projects.listPublished().some((p) => p.id === project.id));
});

test('changing the slug of a published project keeps the old address as a redirect', async () => {
  const project = projects.createProject(sampleProject({ slug: 'old-address' }), null);
  await images.addProjectImage(project.id, { buffer: await makeImage(), originalName: 'c.jpg' });
  const live = projects.setStatus(project.id, 'published', null);
  projects.updateProject(project.id, sampleProject({ slug: 'new-address' }), live.version, null);
  assert.equal(projects.findPublishedBySlug('old-address').movedTo, 'new-address');
  assert.equal(projects.findPublishedBySlug('new-address').project?.id, project.id);
  // The old address cannot be taken by a different project.
  assert.throws(
    () => projects.createProject(sampleProject({ title: 'Чужой', slug: 'old-address' }), null),
    (e: unknown) => e instanceof ValidationError && /раньше принадлежал/.test(e.fields.slug ?? ''),
  );
});

test('deleting a project removes its images, files, revisions and homepage selection', async () => {
  const project = projects.createProject(sampleProject({ slug: 'to-delete' }), null);
  const image = await images.addProjectImage(project.id, { buffer: await makeImage(), originalName: 'd.jpg' });
  const live = projects.setStatus(project.id, 'published', null);
  projects.updateProject(project.id, sampleProject({ slug: 'to-delete', title: 'Правка' }), live.version, null);
  content.initDoc('homepage', content.defaultDoc('homepage'));
  content.saveDraft('homepage', content.defaultDoc('homepage'), content.getDraft('homepage').version, null, [project.id]);
  content.publishDoc('homepage', null);
  assert.deepEqual(content.readFeatured('published'), [project.id]);

  projects.deleteProject(project.id, null);
  assert.equal(projects.getProject(project.id), undefined);
  assert.equal(one('SELECT id FROM images WHERE id = ?', image.id), undefined);
  assert.equal(fs.existsSync(path.join(dir, 'media', image.id)), false);
  assert.equal(all('SELECT * FROM project_revisions WHERE project_id = ?', project.id).length, 0);
  assert.deepEqual(content.readFeatured('published'), []);
  assert.deepEqual(content.readFeatured('draft'), []);
});

test('search, filter and sort', () => {
  const found = projects.listProjects({ q: 'Иннопром' });
  assert.ok(found.length >= 1 && found.every((p) => /Иннопром/.test(p.title)));
  assert.ok(projects.listProjects({ q: '%' }).length === 0, 'LIKE wildcards are escaped');
  assert.ok(projects.listProjects({ status: 'draft' }).every((p) => p.status === 'draft'));
  const titles = projects.listProjects({ sort: 'title', dir: 'asc' }).map((p) => p.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' })) );
});

test('description sections and scope list', () => {
  assert.deepEqual(projects.descriptionSections('Вступление.\n\n## Задача\n\nТекст задачи.\nВторая строка.\n\n## Решение\n\nА.\n\nБ.'), [
    { heading: '', paragraphs: ['Вступление.'] },
    { heading: 'Задача', paragraphs: ['Текст задачи. Вторая строка.'] },
    { heading: 'Решение', paragraphs: ['А.', 'Б.'] },
  ]);
  assert.deepEqual(projects.scopeItems('- Дизайн\n\n• Монтаж\nСвет'), ['Дизайн', 'Монтаж', 'Свет']);
});
