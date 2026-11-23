import type { APIRoute } from 'astro';
import { logActivity } from '@/server/db';
import { NotFoundError } from '@/server/errors';
import { handle, readJson } from '@/server/http';
import { deleteImage, getImage, setImageAlt, toView } from '@/server/images';

function libraryImage(id: string | undefined) {
  const image = getImage(id ?? '');
  if (!image || image.kind !== 'media') throw new NotFoundError('Изображение не найдено');
  return image;
}

export const PATCH: APIRoute = ({ params, request }) =>
  handle(async () => {
    const image = libraryImage(params.id);
    const body = await readJson(request);
    return { image: toView(setImageAlt(image.id, body.alt)) };
  });

/** Refused while the image is used on the homepage, the about section or a service. */
export const DELETE: APIRoute = ({ params, locals }) =>
  handle(() => {
    const image = libraryImage(params.id);
    deleteImage(image.id);
    logActivity(locals.session!.user.id, 'media.delete', `Удалено изображение ${image.original_name}`);
    return { ok: true };
  });
