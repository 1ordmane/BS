import type { APIRoute } from 'astro';
import { handle, intParam, readJson } from '@/server/http';
import { deleteService, getService, updateService } from '@/server/services';

export const PUT: APIRoute = ({ params, request, locals }) =>
  handle(async () => ({ service: updateService(intParam(params.id), (await readJson(request)).data, locals.session!.user.id) }));

/** { published } toggles visibility without opening the form. */
export const PATCH: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const id = intParam(params.id);
    const body = await readJson(request);
    const current = getService(id);
    return { service: updateService(id, { ...current, published: body.published === true }, locals.session!.user.id) };
  });

export const DELETE: APIRoute = ({ params, locals }) =>
  handle(() => {
    deleteService(intParam(params.id), locals.session!.user.id);
    return { ok: true };
  });
