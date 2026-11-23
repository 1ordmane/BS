import type { APIRoute } from 'astro';
import { limits } from '@/server/config';
import { logActivity } from '@/server/db';
import { UserError } from '@/server/errors';
import { handle, readForm } from '@/server/http';
import { addMediaImage, listMedia, mediaUsage, toView } from '@/server/images';

export const GET: APIRoute = () =>
  handle(() => ({ images: listMedia().map((row) => ({ ...toView(row), usage: mediaUsage(row.id) })) }));

export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const form = await readForm(request, limits.imageBytes + 1024 * 1024);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new UserError('Файл не получен');
    const row = await addMediaImage({ buffer: Buffer.from(await file.arrayBuffer()), originalName: file.name, alt: String(form.get('alt') ?? '') });
    logActivity(locals.session!.user.id, 'media.upload', `Загружено изображение ${row.original_name}`);
    return { image: toView(row) };
  });
