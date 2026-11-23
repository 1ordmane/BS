import type { APIRoute } from 'astro';
import { destroyOtherSessions } from '@/server/auth';
import { handle } from '@/server/http';

/** Signs out every other device of the current administrator. */
export const DELETE: APIRoute = ({ locals }) =>
  handle(() => ({ ended: destroyOtherSessions(locals.session!.user.id, locals.session!.id) }));
