import type { APIRoute } from 'astro';
import { restoreHistory } from '@/server/content';
import { docKey } from '@/server/doc-key';
import { handle, intParam } from '@/server/http';

/** Loads an earlier published version into the draft (it is not published by this). */
export const POST: APIRoute = ({ params, locals }) =>
  handle(() => {
    restoreHistory(docKey(params.key), intParam(params.id), locals.session!.user.id);
    return { ok: true };
  });
