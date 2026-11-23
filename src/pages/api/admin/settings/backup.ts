import type { APIRoute } from 'astro';
import { createBackup } from '@/server/backup';
import { logActivity } from '@/server/db';
import { handle } from '@/server/http';

export const POST: APIRoute = ({ locals }) =>
  handle(() => {
    const backup = createBackup('admin');
    logActivity(locals.session!.user.id, 'backup', `Создана резервная копия ${backup.name}`);
    return { backup };
  });
