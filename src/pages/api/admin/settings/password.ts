import type { APIRoute } from 'astro';
import { changePassword } from '@/server/auth';
import { ValidationError } from '@/server/errors';
import { handle, readJson } from '@/server/http';

export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const session = locals.session!;
    const body = await readJson(request);
    if (body.next !== body.repeat) throw new ValidationError({ repeat: 'Пароли не совпадают' });
    changePassword(session.user.id, String(body.current ?? ''), String(body.next ?? ''), session.id);
    return { ok: true };
  });
