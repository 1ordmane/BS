import type { APIRoute } from 'astro';
import { NotFoundError } from '@/server/errors';
import { handle, intParam, readJson } from '@/server/http';
import { deleteImage, getImage, setImageAlt, setProjectCover, toView } from '@/server/images';

function ownImage(projectId: number, imageId: string | undefined) {
  const image = getImage(imageId ?? '');
  if (!image || image.project_id !== projectId) throw new NotFoundError('Изображение не найдено в этом проекте');
  return image;
}

/** { alt } updates the description; { cover: true } makes it the cover. */
export const PATCH: APIRoute = ({ params, request }) =>
  handle(async () => {
    const projectId = intParam(params.id);
    const image = ownImage(projectId, params.imageId);
    const body = await readJson(request);
    if ('alt' in body) setImageAlt(image.id, body.alt);
    if (body.cover === true) setProjectCover(projectId, image.id);
    return { image: toView(getImage(image.id)!) };
  });

export const DELETE: APIRoute = ({ params }) =>
  handle(() => {
    const projectId = intParam(params.id);
    deleteImage(ownImage(projectId, params.imageId).id);
    return { ok: true };
  });
