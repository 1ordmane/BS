import type { APIRoute } from 'astro';
import { limits } from '@/server/config';
import { UserError } from '@/server/errors';
import { handle, intParam, readForm, readJson } from '@/server/http';
import { addProjectImage, listProjectImages, reorderProjectImages, toView } from '@/server/images';
import { requireProject } from '@/server/projects';

const view = (projectId: number) => {
  const project = requireProject(projectId);
  return { coverId: project.cover_image_id, images: listProjectImages(projectId).map((row) => ({ ...toView(row), position: row.position })) };
};

export const GET: APIRoute = ({ params }) => handle(() => view(intParam(params.id)));

/** One image per request, so each file has its own progress and its own error. */
export const POST: APIRoute = ({ params, request }) =>
  handle(async () => {
    const projectId = intParam(params.id);
    const form = await readForm(request, limits.imageBytes + 1024 * 1024);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new UserError('Файл не получен');
    const row = await addProjectImage(projectId, {
      buffer: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
      alt: String(form.get('alt') ?? ''),
    });
    return { image: toView(row), ...view(projectId) };
  });

/** Saves the gallery order: { ids: [...] } with every image of the project exactly once. */
export const PUT: APIRoute = ({ params, request }) =>
  handle(async () => {
    const projectId = intParam(params.id);
    const body = await readJson(request);
    reorderProjectImages(projectId, body.ids);
    return view(projectId);
  });
