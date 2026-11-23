import type { APIRoute } from 'astro';
import { handle, intParam } from '@/server/http';
import { restoreRevision } from '@/server/projects';

export const POST: APIRoute = ({ params, locals }) =>
  handle(() => ({ project: restoreRevision(intParam(params.id), intParam(params.revision), locals.session!.user.id) }));
