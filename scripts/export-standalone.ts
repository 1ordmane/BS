/**
 * Exports the public website into one self-contained HTML file (BuSt.html) that opens
 * straight from disk, without the server.
 *
 *   npm run build && npm run export:html
 *
 * How it works: the built server is started with the published content (DATA_DIR, default
 * ./data); every public page is fetched (home, /projects/, each published project, privacy,
 * consent, 404) and put into one document as a "view". A small router switches views by the address
 * hash (#/projects/…), so links and the back button keep working. Styles, fonts, photos and
 * the logo frames are embedded as data URLs; each photo is stored once.
 *
 * Not included: the admin panel and every /admin or /api/admin route. The inquiry form has
 * no server in this file and says so instead of pretending to send.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
// Vite's own bundler (installed with Astro): used to inline component scripts that share a module.
import { rolldown } from 'rolldown';

const root = process.cwd();
const output = path.join(root, 'BuSt.html');
const client = path.join(root, 'dist', 'client');
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const PHOTO_WIDTH = 1440;

if (!fs.existsSync(path.join(root, 'dist', 'server', 'entry.mjs'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}

/* ---------- Start the built server on a free port ---------- */

const port: number = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server/entry.mjs'], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: String(port) },
  stdio: 'ignore',
});

async function get(url: string): Promise<{ status: number; html: string }> {
  const response = await fetch(base + url, { redirect: 'manual' });
  return { status: response.status, html: await response.text() };
}

try {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(base + '/')).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  /* ---------- Collect the public pages ---------- */

  const home = await get('/');
  const catalog = await get('/projects/');
  const slugs = [...new Set([...catalog.html.matchAll(/href="\/projects\/([a-z0-9-]+)\/"/g)].map((m) => m[1]!))];
  const pages: { key: string; url: string; status: number; html: string }[] = [
    { key: 'home', url: '/', ...home },
    { key: '/projects', url: '/projects/', ...catalog },
    ...(await Promise.all(slugs.map(async (slug) => ({ key: `/projects/${slug}`, url: `/projects/${slug}/`, ...(await get(`/projects/${slug}/`)) })))),
    { key: '/privacy', url: '/privacy/', ...(await get('/privacy/')) },
    { key: '/consent', url: '/consent/', ...(await get('/consent/')) },
    { key: '404', url: '/standalone-export-not-found/', ...(await get('/standalone-export-not-found/')) },
  ];
  for (const page of pages) {
    const expected = page.key === '404' ? 404 : 200;
    if (page.status !== expected) throw new Error(`${page.url} answered ${page.status}`);
  }

  /* ---------- Styles (deduplicated) with fonts embedded ---------- */

  const dataUrl = (file: string, type: string) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  const stylesheets = [...new Set(pages.flatMap((p) => [...p.html.matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)">/g)].map((m) => m[1]!)))];
  // Only the character sets the Russian site uses (Cyrillic, Latin, arrows and symbols).
  const unusedFont = /(greek|vietnamese|math)-/;
  let css = stylesheets.map((href) => fs.readFileSync(path.join(client, href), 'utf8')).join('\n');
  css = css.replace(/@font-face\{[^}]*\}/g, (block) => (unusedFont.test(block) ? '' : block));
  css = css.replace(/url\((\/_astro\/[^)]+\.woff2)\)/g, (_, href: string) => `url(${dataUrl(path.join(client, href), 'font/woff2')})`);
  const inlineStyles = [...new Set(pages.flatMap((p) => [...p.html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!)))];

  /* ---------- Scripts (deduplicated, in page order) ---------- */

  // Component scripts that share a module (e.g. the copy helper used by the contact section
  // and the «Связаться» menu) are emitted as files importing a common chunk; each is bundled
  // here with its imports into one self-contained inline module.
  const bundled = new Map<string, string>();
  async function inlineModule(src: string): Promise<string> {
    if (!bundled.has(src)) {
      if (!src.startsWith('/_astro/')) throw new Error(`external script outside the build: ${src}`);
      const result = await rolldown({ input: path.join(client, src), logLevel: 'silent' });
      const { output } = await result.generate({ format: 'esm', minify: true });
      await result.close();
      if (output.length !== 1 || /\bimport\s*[{(*\w]/.test(output[0].code) || output[0].code.includes('</script')) throw new Error(`could not bundle ${src}`);
      bundled.set(src, output[0].code);
    }
    return bundled.get(src)!;
  }

  const scripts: { attrs: string; body: string }[] = [];
  for (const page of pages) {
    for (const m of page.html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      let attrs = m[1]!;
      let body = m[2]!;
      const src = attrs.match(/\ssrc="([^"]+)"/)?.[1];
      if (src) {
        if (!/type="module"/.test(attrs)) throw new Error(`external classic script in ${page.url}: ${src}`);
        attrs = ' type="module"';
        body = await inlineModule(src);
      }
      if (!scripts.some((s) => s.body === body)) scripts.push({ attrs, body });
    }
  }

  // Logo animation: one frame sheet (the sharp one) and the ring mask, embedded.
  const logo = (file: string, type: string) => dataUrl(path.join(client, 'logo', file), type);
  const sheet = logo('logo-frames-320.webp', 'image/webp');
  for (const script of scripts) {
    if (!script.body.includes('logo-frames-320.webp')) continue;
    const before = script.body;
    script.body = script.body
      .replace(/sheets:\[\{src:`\/logo\/logo-frames-224\.webp`,size:224\},\{src:`\/logo\/logo-frames-320\.webp`,size:320\}\]/, `sheets:[{src:\`${sheet}\`,size:320}]`)
      .replace('`/logo/logo-poster.webp`', `\`${logo('logo-poster.webp', 'image/webp')}\``)
      .replace('`/logo/logo-ring-mask.png`', `\`${logo('logo-ring-mask.png', 'image/png')}\``);
    if (script.body === before || script.body.includes('/logo/')) throw new Error('logo script changed shape; update the export');
  }

  /* ---------- Page bodies as views ---------- */

  // Component scripts sit inside the markup; they are collected above and added once, so strip them here.
  const withoutScripts = (html: string) => html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  const mainOf = (html: string) => withoutScripts(html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '');
  const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'BUSINESS STAND';

  // Ids inside the other views get a prefix, so they do not clash with the homepage.
  function prefixIds(html: string, prefix: string): string {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
    let out = html.replace(/\sid="([^"]+)"/g, (_, id: string) => ` id="${prefix}-${id}"`);
    out = out.replace(/\s(aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g, (_, attr: string, value: string) =>
      ` ${attr}="${value
        .split(' ')
        .map((v) => (ids.includes(v) ? `${prefix}-${v}` : v))
        .join(' ')}"`,
    );
    return out.replace(/href="#([^"/][^"]*)"/g, (all, id: string) => (ids.includes(id) ? `href="#${prefix}-${id}"` : all));
  }

  const views = pages
    .map((page, index) => {
      const body = page.key === 'home' ? mainOf(page.html) : prefixIds(mainOf(page.html), `v${index}`);
      return `<div data-view="${page.key}" data-title="${titleOf(page.html)}"${page.key === 'home' ? '' : ' hidden'}>${body}</div>`;
    })
    .join('\n');

  // Header, footer, skip link and the messenger window come from the homepage.
  const homeBody = home.html.match(/<body[^>]*>([\s\S]*?)<\/body>/)![1]!;
  const header = withoutScripts(homeBody.match(/<header[\s\S]*?<\/header>/)![0]);
  const afterMain = homeBody.slice(homeBody.indexOf('</main>') + '</main>'.length).replace(/<script[\s\S]*?<\/script>/g, '');
  const skip = homeBody.match(/<a class="skip-link"[^>]*>[^<]*<\/a>/)![0];

  const mainTag = homeBody.match(/<main[^>]*>/)![0];
  let bodyHtml = `${skip}\n${header}\n${mainTag}\n${views}\n</main>\n${afterMain}`;

  /* ---------- Links between pages become hash routes ---------- */

  bodyHtml = bodyHtml
    .replace(/href="\/"/g, 'href="#/"')
    .replace(/href="\/#([^"]+)"/g, 'href="#$1"')
    .replace(/href="\/projects\/"/g, 'href="#/projects"')
    .replace(/href="\/projects\/([a-z0-9-]+)\/"/g, 'href="#/projects/$1"')
    .replace(/href="\/privacy\/"/g, 'href="#/privacy"')
    .replace(/href="\/consent\/"/g, 'href="#/consent"');
  const leftover = [...bodyHtml.matchAll(/(?:href|src|action)="(\/[^"]*)"/g)].map((m) => m[1]).filter((v) => !v!.startsWith('/media/') && !v!.startsWith('/logo/'));
  if (leftover.length) throw new Error(`unhandled internal links: ${[...new Set(leftover)].join(', ')}`);

  /* ---------- Photos: each stored once, set by a script at load ---------- */

  const media: Record<string, string> = {};
  bodyHtml = bodyHtml.replace(/<img([^>]*?)\ssrc="\/media\/([a-f0-9]{24})\/[^"]+"([^>]*)>/g, (_, before: string, id: string, after: string) => {
    if (!media[id]) {
      const dir = path.join(dataDir, 'media', id);
      const widths = fs.readdirSync(dir).map((f) => f.match(/^w(\d+)\.webp$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
      const width = widths.filter((w) => w <= PHOTO_WIDTH).at(-1) ?? widths[0]!;
      media[id] = dataUrl(path.join(dir, `w${width}.webp`), 'image/webp');
    }
    // The photo is already inside the file, so there is nothing to load lazily.
    const attrs = `${before}${after}`.replace(/\s(srcset|sizes)="[^"]*"/g, '').replace(/\sloading="lazy"/g, '');
    return `<img${attrs} data-media="${id}">`;
  });
  bodyHtml = bodyHtml.replace(/src="\/logo\/logo-poster\.webp"/g, `src="${logo('logo-poster.webp', 'image/webp')}"`);
  const unembedded = bodyHtml.match(/.{0,120}(\/media\/|\/logo\/).{0,60}/);
  if (unembedded) throw new Error(`an image path was not embedded: ${unembedded[0]}`);

  /* ---------- Assemble ---------- */

  const favicon = dataUrl(path.join(client, 'favicon.svg'), 'image/svg+xml');
  const description = home.html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';

  const standaloneScripts = `
<script>
  // Standalone preview: no server behind this file. The inquiry form is told so honestly.
  (function () {
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url;
      if (url && /\\/api\\//.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({
          error: 'Это автономная копия сайта для просмотра: заявки из неё не отправляются. Напишите нам в мессенджер — кнопка «Обсудить проект».'
        }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      }
      return nativeFetch(input, init);
    };
  })();
</script>`;

  const routerScript = `
<script>
  // Photos are embedded once and attached to every <img> that shows them.
  (function () {
    var media = ${JSON.stringify(media)};
    document.querySelectorAll('img[data-media]').forEach(function (img) {
      var src = media[img.getAttribute('data-media')];
      if (src) img.src = src;
    });
  })();

  // Pages of the site live in one file; the address hash (#/projects/…) selects which one shows.
  (function () {
    var views = Array.prototype.slice.call(document.querySelectorAll('[data-view]'));
    var current = 'home';
    function show() {
      var hash = decodeURIComponent(location.hash || '');
      var key = 'home';
      var anchor = null;
      if (hash.indexOf('#/') === 0) {
        var route = hash.slice(1).replace(/\\/+$/, '') || '/';
        key = route === '/' ? 'home' : views.some(function (v) { return v.getAttribute('data-view') === route; }) ? route : '404';
      } else if (hash.length > 1) {
        anchor = hash.slice(1);
      }
      var changed = key !== current;
      views.forEach(function (v) { v.hidden = v.getAttribute('data-view') !== key; });
      var view = views.filter(function (v) { return v.getAttribute('data-view') === key; })[0];
      if (view) document.title = view.getAttribute('data-title');
      current = key;
      if (anchor) {
        var target = document.getElementById(anchor);
        if (target && changed) requestAnimationFrame(function () { target.scrollIntoView(); });
      } else if (changed) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    }
    window.addEventListener('hashchange', show);
    show();
  })();
</script>`;

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="description" content="${description}">
<meta name="theme-color" content="#123f34">
<title>${titleOf(home.html)}</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<!-- Standalone copy of the BUSINESS STAND website, exported ${new Date().toISOString().slice(0, 10)} for offline preview. -->
<style>
${css}
${inlineStyles.join('\n')}
</style>
${standaloneScripts}
${scripts.filter((s) => !/type="module"/.test(s.attrs)).map((s) => `<script${s.attrs}>${s.body}</script>`).join('\n')}
</head>
<body>
${bodyHtml}
${routerScript}
${scripts.filter((s) => /type="module"/.test(s.attrs)).map((s) => `<script${s.attrs}>${s.body}</script>`).join('\n')}
</body>
</html>
`;

  // Checked outside the embedded files (base64 can contain any letter sequence).
  const adminRef = html.replace(/data:[a-z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/g, '').match(/.{0,80}(\/admin|csrf).{0,40}/i);
  if (adminRef) throw new Error(`admin reference found in the export: ${adminRef[0]}`);
  fs.writeFileSync(output, html);
  console.log(`${path.relative(root, output)}: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB, ${pages.length} pages, ${Object.keys(media).length} photos`);
} finally {
  server.kill();
}
