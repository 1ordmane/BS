import type { APIRoute } from 'astro';
import { getDraft, saveDraft } from '@/server/content';
import { docKey } from '@/server/doc-key';
import { handle, readJson } from '@/server/http';

/** Saves the draft: { doc, version, featured? }. Visitors keep seeing the published version. */
export const PUT: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const key = docKey(params.key);
    const body = await readJson(request);
    saveDraft(key, body.doc, body.version, locals.session!.user.id, body.featured);
    const draft = getDraft(key);
    return { version: draft.version, pending: draft.pending, updatedAt: draft.updatedAt };
  });
