import type { APIRoute } from 'astro';
import { discardDraft } from '@/server/content';
import { docKey } from '@/server/doc-key';
import { handle } from '@/server/http';

export const POST: APIRoute = ({ params, locals }) =>
  handle(() => {
    discardDraft(docKey(params.key), locals.session!.user.id);
    return { ok: true };
  });
