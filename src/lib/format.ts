/** Date formatting for the admin panel (server-rendered, Moscow time by default). */
const TIME_ZONE = process.env.TZ_DISPLAY ?? 'Europe/Moscow';

export function formatDate(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
