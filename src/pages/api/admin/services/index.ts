import type { APIRoute } from 'astro';
import { handle, readJson } from '@/server/http';
import { createService } from '@/server/services';

export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => ({ service: createService((await readJson(request)).data, locals.session!.user.id) }));
