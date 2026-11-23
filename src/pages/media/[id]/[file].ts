import fs from 'node:fs';
import type { APIRoute } from 'astro';
import { one } from '@/server/db';
import { getImage, mediaFilePath } from '@/server/images';

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg' };

/**
 * Serves uploaded images. Ids are random, file names come from a fixed pattern (no path
 * traversal), and images of unpublished projects are only served to a signed-in admin.
 */
export const GET: APIRoute = ({ params, locals }) => {
  const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const file = mediaFilePath(params.id ?? '', params.file ?? '');
  const image = file ? getImage(params.id!) : undefined;
  if (!file || !image || !fs.existsSync(file)) return notFound();

  let isPublic = true;
  if (image.project_id !== null) {
    const project = one<{ status: string }>('SELECT status FROM projects WHERE id = ?', image.project_id);
    isPublic = project?.status === 'published';
  }
  if (!isPublic && !locals.session) return notFound();

  const body = fs.readFileSync(file);
  return new Response(body, {
    headers: {
      'Content-Type': TYPES[file.split('.').pop()!] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      // Files never change under the same id; a replaced image gets a new id.
      'Cache-Control': isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store',
    },
  });
};
