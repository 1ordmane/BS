import type { APIRoute } from 'astro';
import { handle, readJson } from '@/server/http';
import { createProject } from '@/server/projects';

export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const body = await readJson(request);
    const project = createProject(body.data, locals.session!.user.id);
    return { project };
  });
