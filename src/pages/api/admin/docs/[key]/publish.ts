import type { APIRoute } from 'astro';
import { getDraft, publishDoc } from '@/server/content';
import { docKey } from '@/server/doc-key';
import { handle } from '@/server/http';

export const POST: APIRoute = ({ params, locals }) =>
  handle(() => {
    const key = docKey(params.key);
    publishDoc(key, locals.session!.user.id);
    const draft = getDraft(key);
    return { version: draft.version, pending: draft.pending, publishedAt: draft.publishedAt };
  });
