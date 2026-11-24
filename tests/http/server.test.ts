/**
 * End-to-end HTTP tests against the built server (run with `npm run test:http`, which builds
 * first). The server runs on a free port with its own temporary data directory.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { makeImage } from '../helpers.ts';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-http-'));
// Inquiries are e-mailed; in the tests the messages are written here instead of being sent.
const outbox = path.join(dataDir, 'outbox');
const EMAIL = 'admin@test.local';
const PASSWORD = 'http-test-password-1';
let server: ChildProcess;
let base = '';
let origin = '';

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

before(async () => {
  const env = { ...process.env, DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD };
  const created = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/admin-create.ts', '--email', EMAIL], { cwd: root, env, encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);

  const port = await freePort();
  base = origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server/entry.mjs'], {
    cwd: root,
    env: { ...env, HOST: '127.0.0.1', PORT: String(port), MAIL_OUTBOX_DIR: outbox },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  // The first request seeds the database with the launch content (takes a few seconds).
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${base}/`);
      if (response.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/* ---------- Small HTTP client keeping the session cookie ---------- */

let cookie = '';
let csrf = '';

async function request(method: string, url: string, init: { body?: BodyInit; json?: unknown; headers?: Record<string, string>; auth?: boolean; csrf?: string | null } = {}) {
  const headers: Record<string, string> = { Origin: origin, ...init.headers };
  if (init.auth !== false && cookie) headers.Cookie = cookie;
  const token = init.csrf === undefined ? csrf : init.csrf;
  if (token) headers['X-CSRF-Token'] = token;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  return fetch(base + url, { method, headers, body, redirect: 'manual' });
}

async function login(email = EMAIL, password = PASSWORD) {
  const form = new URLSearchParams({ email, password, next: '/admin' });
  return fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'manual',
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

/* ---------- Tests ---------- */

describe('access control', () => {
  test('admin pages redirect to login, admin API answers 401', async () => {
    const page = await request('GET', '/admin/projects', { auth: false });
    assert.equal(page.status, 302);
    assert.match(page.headers.get('location')!, /\/admin\/login\?next=%2Fadmin%2Fprojects/);
    assert.equal((await request('GET', '/api/admin/media', { auth: false })).status, 401);
    assert.equal((await request('POST', '/api/admin/projects', { auth: false, json: { data: { title: 'x' } } })).status, 401);
    assert.equal((await request('DELETE', '/api/admin/projects/1', { auth: false })).status, 401);
    assert.equal((await request('GET', '/admin/requests/1/attachment', { auth: false })).status, 302);
  });

  test('wrong password is refused with a generic message', async () => {
    const response = await login(EMAIL, 'wrong-password-123');
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Неверный логин или пароль/);
    assert.equal(response.headers.get('set-cookie'), null);
  });

  test('login sets an HttpOnly, SameSite session cookie', async () => {
    const response = await login();
    assert.equal(response.status, 303);
    const setCookie = response.headers.get('set-cookie')!;
    assert.match(setCookie, /bs_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    cookie = setCookie.split(';')[0]!;
    const page = await request('GET', '/admin');
    assert.equal(page.status, 200);
    const html = await page.text();
    csrf = html.match(/name="csrf-token" content="([^"]+)"/)![1]!;
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(page.headers.get('x-robots-tag')!, /noindex/);
  });

  test('state-changing requests need the CSRF token', async () => {
    assert.equal((await request('POST', '/api/admin/projects', { json: { data: { title: 'x' } }, csrf: null })).status, 403);
    assert.equal((await request('POST', '/api/admin/projects', { json: { data: { title: 'x' } }, csrf: 'forged-token' })).status, 403);
  });

  test('cross-site form posts are rejected', async () => {
    const form = new FormData();
    form.append('name', 'x');
    const response = await fetch(`${base}/api/inquiry`, { method: 'POST', body: form, headers: { Origin: 'https://evil.example' } });
    assert.equal(response.status, 403);
  });
});

describe('projects and images', () => {
  let id = 0;
  let slug = '';
  const imageIds: string[] = [];

  test('create a draft (validated on the server)', async () => {
    const bad = await request('POST', '/api/admin/projects', { json: { data: { title: '', category: 'island' } } });
    assert.equal(bad.status, 422);
    assert.ok((await json(bad)).fields.title);

    const response = await request('POST', '/api/admin/projects', {
      json: { data: { title: 'HTTP-тест стенд', category: 'corner', summary: 'Проверка полного цикла публикации.', description: '## Задача\n\nПроверить сайт.' } },
    });
    assert.equal(response.status, 200);
    const { project } = await json(response);
    id = project.id;
    slug = project.slug;
    assert.equal(project.status, 'draft');
    assert.equal(slug, 'http-test-stend');
  });

  test('a draft is not public and cannot be published without a cover', async () => {
    assert.equal((await request('GET', `/projects/${slug}/`, { auth: false })).status, 404);
    const publish = await request('POST', `/api/admin/projects/${id}/status`, { json: { status: 'published' } });
    assert.equal(publish.status, 422);
  });

  test('upload images (one per request), non-images are refused', async () => {
    const fake = new FormData();
    fake.append('file', new Blob([new Uint8Array(Buffer.from('not an image'))], { type: 'image/jpeg' }), 'fake.jpg');
    assert.equal((await request('POST', `/api/admin/projects/${id}/images`, { body: fake })).status, 415);

    for (const color of ['#aa0000', '#00aa00', '#0000aa']) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(await makeImage(1200, 800, 'jpeg', color))], { type: 'image/jpeg' }), `${color}.jpg`);
      const response = await request('POST', `/api/admin/projects/${id}/images`, { body: form });
      assert.equal(response.status, 200);
      imageIds.push((await json(response)).image.id);
    }
    const view = await json(await request('GET', `/api/admin/projects/${id}/images`));
    assert.deepEqual(view.images.map((i: { id: string }) => i.id), imageIds);
    assert.equal(view.coverId, imageIds[0]);
  });

  test('images of an unpublished project are only served to the admin', async () => {
    assert.equal((await request('GET', `/media/${imageIds[0]}/thumb.webp`, { auth: false })).status, 404);
    const own = await request('GET', `/media/${imageIds[0]}/thumb.webp`);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('content-type'), 'image/webp');
    assert.equal((await request('GET', `/media/${imageIds[0]}/..%2F..%2Fsite.db`)).status, 404);
  });

  test('reorder persists; an incomplete order is refused', async () => {
    const order = [imageIds[2], imageIds[0], imageIds[1]];
    const ok = await request('PUT', `/api/admin/projects/${id}/images`, { json: { ids: order } });
    assert.equal(ok.status, 200);
    const view = await json(await request('GET', `/api/admin/projects/${id}/images`));
    assert.deepEqual(view.images.map((i: { id: string }) => i.id), order);
    const partial = await request('PUT', `/api/admin/projects/${id}/images`, { json: { ids: order.slice(0, 2) } });
    assert.equal(partial.status, 409);
  });

  test('cover change and delete', async () => {
    assert.equal((await request('PATCH', `/api/admin/projects/${id}/images/${imageIds[1]}`, { json: { cover: true } })).status, 200);
    assert.equal((await request('DELETE', `/api/admin/projects/${id}/images/${imageIds[0]}`)).status, 200);
    const view = await json(await request('GET', `/api/admin/projects/${id}/images`));
    assert.equal(view.images.length, 2);
    assert.equal(view.coverId, imageIds[1]);
  });

  test('admin preview of the draft works', async () => {
    const preview = await request('GET', `/admin/projects/${id}/preview`);
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /HTTP-тест стенд/);
  });

  test('publish: page, gallery, SEO and catalogue are public', async () => {
    const response = await request('POST', `/api/admin/projects/${id}/status`, { json: { status: 'published' } });
    assert.equal(response.status, 200);
    const page = await request('GET', `/projects/${slug}/`, { auth: false });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<h1[^>]*>HTTP-тест стенд<\/h1>/);
    assert.match(html, /<title>HTTP-тест стенд — BUSINESS STAND<\/title>/);
    assert.match(html, /<meta name="description" content="Проверка полного цикла публикации\."/);
    assert.match(html, new RegExp(`og:image" content="[^"]*/media/${imageIds[1]}/og\\.jpg`));
    assert.match(html, new RegExp(`/media/${imageIds[2]}/w`), 'gallery image rendered');
    assert.equal((await request('GET', `/media/${imageIds[1]}/w480.webp`, { auth: false })).status, 200);
    assert.match(await (await request('GET', '/projects/', { auth: false })).text(), /HTTP-тест стенд/);
  });

  test('editing with a stale version is refused (no silent overwrite)', async () => {
    const data = { title: 'HTTP-тест стенд', slug: 'http-test-renamed', category: 'corner', summary: 'Проверка полного цикла публикации.' };
    const stale = await request('PUT', `/api/admin/projects/${id}`, { json: { data, version: 1 } });
    assert.equal(stale.status, 409);
  });

  test('renaming the address redirects the old one', async () => {
    const current = await json(await request('GET', `/api/admin/projects/${id}/images`));
    assert.ok(current);
    const list = await (await request('GET', '/admin/projects')).text();
    assert.match(list, /http-test-stend/);
    const page = await (await request('GET', `/admin/projects/${id}`)).text();
    const version = Number(page.match(/data-version="(\d+)"/)![1]);
    const data = { title: 'HTTP-тест стенд', slug: 'http-test-renamed', category: 'corner', summary: 'Проверка полного цикла публикации.' };
    assert.equal((await request('PUT', `/api/admin/projects/${id}`, { json: { data, version } })).status, 200);
    const old = await request('GET', `/projects/${slug}/`, { auth: false });
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/projects/http-test-renamed/');
    slug = 'http-test-renamed';
  });

  test('unpublish hides the page again', async () => {
    assert.equal((await request('POST', `/api/admin/projects/${id}/status`, { json: { status: 'draft' } })).status, 200);
    assert.equal((await request('GET', `/projects/${slug}/`, { auth: false })).status, 404);
    assert.doesNotMatch(await (await request('GET', '/projects/', { auth: false })).text(), /HTTP-тест стенд/);
  });
});

describe('homepage drafts', () => {
  test('a saved draft is visible in the preview only; publishing makes it public', async () => {
    const page = await (await request('GET', '/admin/homepage')).text();
    const version = Number(page.match(/data-doc-key="homepage" data-version="(\d+)"/)![1]);
    const draft = await json(await request('GET', '/api/admin/media'));
    assert.ok(Array.isArray(draft.images));

    // Build the document from the current published homepage, change the hero subtitle.
    const home = await (await request('GET', '/', { auth: false })).text();
    assert.match(home, /Выставочные стенды/);
    const docResponse = await request('PUT', '/api/admin/docs/homepage', {
      json: { version, doc: await currentHomepageDoc(), featured: [] },
    });
    assert.equal(docResponse.status, 200, JSON.stringify(await docResponse.clone().json()));

    assert.doesNotMatch(await (await request('GET', '/', { auth: false })).text(), /Подзаголовок из HTTP-теста/);
    assert.match(await (await request('GET', '/admin/preview')).text(), /Подзаголовок из HTTP-теста/);

    assert.equal((await request('POST', '/api/admin/docs/homepage/publish')).status, 200);
    const published = await (await request('GET', '/', { auth: false })).text();
    assert.match(published, /Подзаголовок из HTTP-теста/);
    // The selection was published empty, so the portfolio section is gone from the homepage.
    assert.doesNotMatch(published, /id="projects"/);
  });
});

describe('homepage project gallery', () => {
  test('shows selected published projects in order; unpublished ones drop out', async () => {
    const make = async (title: string, color: string) => {
      const created = await json(await request('POST', '/api/admin/projects', { json: { data: { title, category: 'island', summary: 'Проект для галереи на главной.' } } }));
      const id = created.project.id as number;
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(await makeImage(1200, 800, 'jpeg', color))], { type: 'image/jpeg' }), 'c.jpg');
      assert.equal((await request('POST', `/api/admin/projects/${id}/images`, { body: form })).status, 200);
      assert.equal((await request('POST', `/api/admin/projects/${id}/status`, { json: { status: 'published' } })).status, 200);
      return { id, slug: created.project.slug as string };
    };
    const first = await make('Галерея первый', '#204060');
    const second = await make('Галерея второй', '#602040');

    const page = await (await request('GET', '/admin/homepage')).text();
    const version = Number(page.match(/data-doc-key="homepage" data-version="(\d+)"/)![1]);
    const saved = await request('PUT', '/api/admin/docs/homepage', { json: { version, doc: await currentHomepageDoc(), featured: [second.id, first.id] } });
    assert.equal(saved.status, 200);
    assert.equal((await request('POST', '/api/admin/docs/homepage/publish')).status, 200);

    const home = await (await request('GET', '/', { auth: false })).text();
    const gallery = home.slice(home.indexOf('id="projects"'));
    const links = [...gallery.matchAll(/class="work" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(links, [`/projects/${second.slug}/`, `/projects/${first.slug}/`], 'selection order');
    assert.match(gallery, /Все проекты/);
    for (const link of links) assert.equal((await request('GET', link!, { auth: false })).status, 200);

    assert.equal((await request('POST', `/api/admin/projects/${second.id}/status`, { json: { status: 'draft' } })).status, 200);
    const after = await (await request('GET', '/', { auth: false })).text();
    assert.doesNotMatch(after, new RegExp(`/projects/${second.slug}/`), 'unpublished project is not shown');
    assert.match(after, new RegExp(`/projects/${first.slug}/`));
  });
});

/** Reads the homepage draft back from the edit form's fields. */
async function currentHomepageDoc() {
  const html = await (await request('GET', '/admin/homepage')).text();
  const value = (name: string) => {
    const input = html.match(new RegExp(`name="${name.replace(/\./g, '\\.')}"[^>]*value="([^"]*)"`));
    if (input) return input[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const area = html.match(new RegExp(`name="${name.replace(/\./g, '\\.')}"[^>]*>([^<]*)</textarea>`));
    return area ? area[1]! : '';
  };
  const select = (name: string) => html.match(new RegExp(`name="${name.replace(/\./g, '\\.')}"[\\s\\S]*?<option value="([^"]+)" selected`))?.[1] ?? 'DraftingCompass';
  return {
    hero: {
      lines: value('hero.lines'),
      text: 'Подзаголовок из HTTP-теста',
      imageId: value('hero.imageId'),
      imageAlt: value('hero.imageAlt'),
      primaryLabel: value('hero.primaryLabel'),
      primaryHref: value('hero.primaryHref'),
      secondaryLabel: value('hero.secondaryLabel'),
      secondaryHref: value('hero.secondaryHref'),
    },
    highlights: [0, 1, 2].map((i) => ({
      title: value(`highlights.${i}.title`),
      text: value(`highlights.${i}.text`),
      icon: select(`highlights.${i}.icon`),
      href: value(`highlights.${i}.href`),
    })),
    services: { title: value('services.title'), text: value('services.text') },
    projects: { title: value('projects.title'), text: value('projects.text'), notice: value('projects.notice') },
    contact: { title: value('contact.title'), text: value('contact.text'), imageId: value('contact.imageId'), imageAlt: value('contact.imageAlt') },
    seo: { title: value('seo.title'), description: value('seo.description') },
  };
}

describe('inquiries', () => {
  const fields = {
    name: 'Иван',
    email: 'ivan@example.ru',
    phone: '+7 900 000-00-00',
    message: 'Нужен угловой стенд 24 м² на выставку в марте.',
    // The value the public form's checkbox sends (InquiryForm.astro).
    consent: 'yes',
  };

  const send = (extra: Record<string, string> = {}, file?: { name: string; data: Buffer }) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...fields, ...extra })) form.append(k, v);
    if (file) form.append('brief', new Blob([new Uint8Array(file.data)]), file.name);
    return fetch(`${base}/api/inquiry`, { method: 'POST', body: form, headers: { Origin: origin, 'X-Forwarded-For': '1.2.3.4' } });
  };

  test('validation errors come back per field', async () => {
    const response = await send({ email: 'bad', message: 'коротко' });
    assert.equal(response.status, 422);
    const body = await json(response);
    assert.ok(body.fields.email);
    assert.equal(body.fields.message, undefined, 'a short description is fine: the field is optional');
    // Neither email nor phone: one shared message for the pair.
    const none = await json(await send({ email: '', phone: '' }));
    assert.match(none.fields.contact, /почту или телефон/);
  });

  const messages = () => (fs.existsSync(outbox) ? fs.readdirSync(outbox).filter((f) => f.endsWith('.eml')).sort() : []);

  test('an inquiry without a project description is accepted and e-mailed', async () => {
    const before = messages().length;
    const response = await send({ message: '' });
    assert.equal(response.status, 200);
    assert.equal(messages().length, before + 1);
  });

  test('a valid inquiry with an attachment is e-mailed to the company, not stored on the site', async () => {
    const before = messages().length;
    const response = await send({}, { name: 'brief.pdf', data: Buffer.from('%PDF-1.4 brief') });
    assert.equal(response.status, 200);
    const sent = messages();
    assert.equal(sent.length, before + 1, 'one message');
    const eml = fs.readFileSync(path.join(outbox, sent.at(-1)!), 'utf8');
    assert.match(eml, /^To: businesstend@yandex\.ru$/m);
    assert.match(eml, /^Reply-To:[^\n]*(?:\n [^\n]*)*ivan@example\.ru/m, 'header may be folded');
    assert.match(eml, /filename=.?brief\.pdf/);
    assert.match(eml, /Content-Transfer-Encoding: base64/);
    // Nothing reaches the admin panel.
    assert.doesNotMatch(await (await request('GET', '/admin/requests?status=all')).text(), /href="\/admin\/requests\/\d+"/);
  });

  test('honeypot submissions are accepted silently and not sent', async () => {
    const before = messages().length;
    assert.equal((await send({ website: 'http://spam.example', name: 'Бот' })).status, 200);
    assert.equal(messages().length, before);
  });

  test('too many inquiries from one address are rate limited', async () => {
    let limited = false;
    for (let i = 0; i < 6; i += 1) if ((await send()).status === 429) limited = true;
    assert.ok(limited);
  });
});

describe('login protection and logout', () => {
  test('logout needs the CSRF field and ends the session', async () => {
    const forged = await request('POST', '/admin/logout', { body: new URLSearchParams({ _csrf: 'nope' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(forged.status, 403);
    const ok = await request('POST', '/admin/logout', { body: new URLSearchParams({ _csrf: csrf }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(ok.status, 303);
    assert.equal((await request('GET', '/admin')).status, 302, 'old cookie no longer works');
  });

  test('repeated wrong passwords lock the account', async () => {
    for (let i = 0; i < 5; i += 1) await login(EMAIL, `wrong-${i}-password`);
    const locked = await login();
    assert.equal(locked.status, 429);
    assert.match(await locked.text(), /Слишком много попыток/);
  });
});
