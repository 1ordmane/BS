import type { APIRoute } from 'astro';
import { handle, readJson } from '@/server/http';
import { reorderServices } from '@/server/services';

export const PUT: APIRoute = ({ request, locals }) =>
  handle(async () => ({ services: reorderServices((await readJson(request)).ids, locals.session!.user.id) }));
