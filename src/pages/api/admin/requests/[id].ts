import type { APIRoute } from 'astro';
import { handle, intParam, readJson } from '@/server/http';
import { deleteInquiry, updateInquiry } from '@/server/inquiries';

export const PUT: APIRoute = ({ params, request }) =>
  handle(async () => ({ inquiry: updateInquiry(intParam(params.id), await readJson(request)) }));

export const DELETE: APIRoute = ({ params }) =>
  handle(() => {
    deleteInquiry(intParam(params.id));
    return { ok: true };
  });
