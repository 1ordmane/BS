import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldError, makeImage, sampleProject, useTempData } from '../helpers.ts';

useTempData();
const content = await import('../../src/server/content.ts');
const projects = await import('../../src/server/projects.ts');
const images = await import('../../src/server/images.ts');
const site = await import('../../src/server/site.ts');
const { ConflictError, ValidationError, UserError } = await import('../../src/server/errors.ts');

content.initDoc('homepage', content.defaultDoc('homepage'));
content.initDoc('about', content.defaultDoc('about'));
content.initDoc('company', content.defaultDoc('company'));

async function publishedProject(slug: string) {
  const project = projects.createProject(sampleProject({ slug, title: slug }), null);
  await images.addProjectImage(project.id, { buffer: await makeImage(), originalName: `${slug}.jpg` });
  return projects.setStatus(project.id, 'published', null);
}

test('saving a draft does not change what visitors see', () => {
  const draft = content.getDraft('homepage');
  const doc = structuredClone(draft.doc);
  doc.hero.lines = ['Новый', 'заголовок'];
  content.saveDraft('homepage', doc, draft.version, null, []);
  assert.deepEqual(content.getDraft('homepage').doc.hero.lines, ['Новый', 'заголовок']);
  assert.notDeepEqual(content.getPublished('homepage').hero.lines, ['Новый', 'заголовок']);
  assert.equal(content.getDraft('homepage').pending, true);
  assert.notDeepEqual(site.buildSite('published').homepage.hero.lines, ['Новый', 'заголовок']);
  assert.deepEqual(site.buildSite('draft').homepage.hero.lines, ['Новый', 'заголовок']);
});

test('publishing copies the draft, records history and touches no other document', () => {
  const aboutBefore = content.getPublished('about');
  content.publishDoc('homepage', null);
  assert.deepEqual(content.getPublished('homepage').hero.lines, ['Новый', 'заголовок']);
  assert.equal(content.getDraft('homepage').pending, false);
  assert.equal(content.listHistory('homepage').length, 1);
  assert.deepEqual(content.getPublished('about'), aboutBefore);
});

test('validation rejects bad links, empty headings and wrong list sizes', () => {
  const doc = structuredClone(content.getDraft('homepage').doc) as Record<string, any>;
  doc.hero.primaryHref = 'javascript:alert(1)';
  doc.hero.lines = [];
  doc.highlights = doc.highlights.slice(0, 2);
  assert.throws(
    () => content.saveDraft('homepage', doc, content.getDraft('homepage').version, null, []),
    (e: unknown) => e instanceof ValidationError && 'hero.primaryHref' in e.fields && 'hero.lines' in e.fields && 'highlights' in e.fields,
  );
  const about = structuredClone(content.getDraft('about').doc) as Record<string, any>;
  about.approach.stages = [{ title: '', text: 'x' }];
  assert.throws(
    () => content.saveDraft('about', about, content.getDraft('about').version, null),
    (e: unknown) => e instanceof ValidationError && 'approach.stages' in e.fields && 'approach.stages.0.title' in e.fields,
  );
});

test('a stale draft version is refused', () => {
  const draft = content.getDraft('company');
  content.saveDraft('company', { ...draft.doc, phone: '+7 900 000-00-00' }, draft.version, null);
  assert.throws(() => content.saveDraft('company', draft.doc, draft.version, null), ConflictError);
});

test('homepage selection: no duplicates, no deleted ids, only published projects go live', async () => {
  const a = await publishedProject('alpha');
  const b = await publishedProject('beta');
  const version = () => content.getDraft('homepage').version;
  const doc = content.getDraft('homepage').doc;
  assert.throws(() => content.saveDraft('homepage', doc, version(), null, [a.id, a.id]), fieldError('featured', /дважды/));
  assert.throws(() => content.saveDraft('homepage', doc, version(), null, [a.id, 99999]), fieldError('featured', /удалены/));

  content.saveDraft('homepage', doc, version(), null, [b.id, a.id]);
  assert.deepEqual(content.readFeatured('draft'), [b.id, a.id]);
  assert.deepEqual(content.readFeatured('published'), [], 'selection is not live before publishing');

  projects.setStatus(b.id, 'draft', null);
  assert.throws(() => content.publishDoc('homepage', null), (e: unknown) => e instanceof UserError && /неопубликованные/.test(e.message));
  projects.setStatus(b.id, 'published', null);
  content.publishDoc('homepage', null);
  assert.deepEqual(site.buildSite('published').featured.map((p) => p.slug), ['beta', 'alpha']);

  // Unpublishing later hides it from the homepage without breaking the page.
  projects.setStatus(a.id, 'draft', null);
  assert.deepEqual(site.buildSite('published').featured.map((p) => p.slug), ['beta']);
});

test('the homepage shows the first HOMEPAGE_PROJECTS published projects; the rest wait in reserve', async () => {
  const limit = site.HOMEPAGE_PROJECTS;
  assert.equal(limit, 6);
  // One more published project than the homepage shows, so one waits in reserve.
  const names = ['gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'].slice(0, limit + 1);
  const extra: Awaited<ReturnType<typeof publishedProject>>[] = [];
  for (const name of names) extra.push(await publishedProject(name));
  const ids = extra.map((p) => p.id);
  content.saveDraft('homepage', content.getDraft('homepage').doc, content.getDraft('homepage').version, null, ids.slice(0, limit + 1));
  content.publishDoc('homepage', null);
  const slug = (id: number) => projects.getProject(id)!.slug;
  assert.deepEqual(site.buildSite('published').featured.map((p) => p.slug), ids.slice(0, limit).map(slug));
  projects.setStatus(extra[1]!.id, 'draft', null);
  const expected = ids.slice(0, limit + 1).filter((id) => id !== extra[1]!.id).map(slug);
  assert.deepEqual(site.buildSite('published').featured.map((p) => p.slug), expected, 'the reserve project moves up');
  projects.setStatus(extra[1]!.id, 'published', null);
});

test('discard returns the draft to the published version; history restores into the draft only', () => {
  const draft = content.getDraft('homepage');
  const changed = structuredClone(draft.doc);
  changed.hero.text = 'Черновой подзаголовок';
  content.saveDraft('homepage', changed, draft.version, null, content.readFeatured('draft'));
  content.discardDraft('homepage', null);
  assert.equal(content.getDraft('homepage').doc.hero.text, content.getPublished('homepage').hero.text);

  // The oldest version had an empty selection; restoring it changes the draft, not the site.
  const publishedBefore = JSON.stringify([content.getPublished('homepage'), content.readFeatured('published')]);
  const first = content.listHistory('homepage').at(-1)!;
  content.restoreHistory('homepage', first.id, null);
  assert.equal(content.getDraft('homepage').pending, true);
  assert.deepEqual(content.readFeatured('draft'), []);
  assert.equal(JSON.stringify([content.getPublished('homepage'), content.readFeatured('published')]), publishedBefore);
});

test('company contacts are validated', () => {
  const draft = content.getDraft('company');
  assert.throws(
    () => content.saveDraft('company', { ...draft.doc, email: 'nope', telegram: 'http://t.me/x', phone: '12' }, draft.version, null),
    (e: unknown) => e instanceof ValidationError && ['email', 'telegram', 'phone'].every((k) => k in e.fields),
  );
});

test('referenced images must exist in the media library', () => {
  const draft = content.getDraft('homepage');
  const doc = structuredClone(draft.doc);
  doc.hero.imageId = 'ffffffffffffffffffffffff';
  assert.throws(() => content.saveDraft('homepage', doc, draft.version, null, []), (e: unknown) => e instanceof ValidationError && 'hero.imageId' in e.fields);
});
