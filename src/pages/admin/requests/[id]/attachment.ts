import fs from 'node:fs';
import type { APIRoute } from 'astro';
import { NotFoundError } from '@/server/errors';
import { attachmentPath, getInquiry } from '@/server/inquiries';

/** Admin-only download (the middleware requires a session). Always served as a download, never inline. */
export const GET: APIRoute = ({ params }) => {
  try {
    const inquiry = getInquiry(Number(params.id));
    const file = attachmentPath(inquiry);
    if (!file) throw new NotFoundError();
    const body = fs.readFileSync(file);
    const name = inquiry.attachment_name ?? 'attachment';
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).replace(/[^.\w]/g, '') : '';
    return new Response(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="attachment${ext}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
