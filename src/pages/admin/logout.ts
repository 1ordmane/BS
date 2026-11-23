import type { APIRoute } from 'astro';
import { checkCsrf, destroySession } from '@/server/auth';
import { session as sessionConfig } from '@/server/config';

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const session = locals.session;
  if (session) {
    const form = await request.formData().catch(() => null);
    if (!checkCsrf(session, String(form?.get('_csrf') ?? ''))) return new Response('Страница устарела, обновите её', { status: 403 });
    destroySession(session.id);
  }
  cookies.delete(sessionConfig.cookie, { path: '/' });
  return redirect('/admin/login', 303);
};
