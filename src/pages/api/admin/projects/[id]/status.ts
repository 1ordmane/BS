import type { APIRoute } from 'astro';
import { handle, intParam, readJson } from '@/server/http';
import { setStatus } from '@/server/projects';

export const POST: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const body = await readJson(request);
    const status = body.status === 'published' ? 'published' : 'draft';
    return { project: setStatus(intParam(params.id), status, locals.session!.user.id) };
  });
