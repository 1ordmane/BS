import { defineMiddleware } from 'astro:middleware';
import { checkCsrf, pruneRateLimits, readSession } from './server/auth.ts';
import { limits, session as sessionConfig } from './server/config.ts';
import { getDb } from './server/db.ts';
import { json } from './server/http.ts';
import { sweepOrphanMedia } from './server/images.ts';
import { seedIfEmpty } from './server/seed.ts';
import { buildSite } from './server/site.ts';

let ready: Promise<void> | null = null;

/** Opens the database (applying migrations), seeds an empty one and tidies leftovers. */
function prepare(): Promise<void> {
  ready ??= (async () => {
    getDb();
    await seedIfEmpty();
    sweepOrphanMedia();
    pruneRateLimits();
    // Keeps the promise of the privacy policy: IP addresses for rate limits live less than a day.
    setInterval(() => {
      try {
        pruneRateLimits();
      } catch {
        // A busy database is fine: the next run catches up.
      }
    }, 30 * 60 * 1000).unref();
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Adds headers; responses such as Response.redirect() have immutable headers and are copied. */
function withHeaders(response: Response, headers: Record<string, string>): Response {
  let target = response;
  try {
    for (const [name, value] of Object.entries(headers)) target.headers.set(name, value);
  } catch {
    target = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) target.headers.set(name, value);
  }
  return target;
}

const ADMIN_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

const PUBLIC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

// Forms that check their own token (login has no session yet, logout reads a form field).
const SELF_CHECKED = new Set(['/admin/login', '/admin/logout']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const isAdminPage = path === '/admin' || path.startsWith('/admin/');
  const isAdminApi = path.startsWith('/api/admin/');
  const isMedia = path.startsWith('/media/');

  await prepare();

  if (!SAFE_METHODS.has(context.request.method) && Number(context.request.headers.get('content-length') ?? 0) > limits.requestBytes) {
    return json({ error: 'Слишком большой запрос' }, 413);
  }

  const token = context.cookies.get(sessionConfig.cookie)?.value;
  context.locals.session = isAdminPage || isAdminApi || isMedia ? readSession(token) : null;

  if (isAdminPage || isAdminApi) {
    const session = context.locals.session;
    if (!session && path !== '/admin/login') {
      if (isAdminApi) return json({ error: 'Сессия истекла. Войдите снова.' }, 401);
      const target = `${context.url.pathname}${context.url.search}`;
      return context.redirect(`/admin/login?next=${encodeURIComponent(target)}`, 302);
    }
    if (session && !SAFE_METHODS.has(context.request.method) && !SELF_CHECKED.has(path)) {
      if (!checkCsrf(session, context.request.headers.get('x-csrf-token'))) {
        return json({ error: 'Страница устарела. Обновите её и повторите действие.' }, 403);
      }
    }

    return withHeaders(await next(), ADMIN_HEADERS);
  }

  if (!isMedia && !path.startsWith('/api/')) context.locals.site = buildSite('published');

  return withHeaders(await next(), PUBLIC_HEADERS);
});
