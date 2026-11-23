import path from 'node:path';

/**
 * Server configuration. Everything comes from environment variables so that
 * no secrets or machine-specific paths live in the repository.
 */

/** Directory with the database, uploaded media, inquiry attachments and backups. */
export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

export const paths = {
  db: () => path.join(dataDir(), 'site.db'),
  media: () => path.join(dataDir(), 'media'),
  attachments: () => path.join(dataDir(), 'attachments'),
  backups: () => path.join(dataDir(), 'backups'),
};

export const limits = {
  /** One uploaded image. */
  imageBytes: 20 * 1024 * 1024,
  /** Decoded pixel limit, protects against decompression bombs. */
  imagePixels: 80_000_000,
  /** Inquiry attachment, matches the limit shown on the public form. */
  attachmentBytes: 10 * 1024 * 1024,
  /** Upper bound for any request body we parse. */
  requestBytes: 25 * 1024 * 1024,
};

export const session = {
  /** Absolute lifetime of a session. */
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** A session not used for this long expires. */
  idleMs: 12 * 60 * 60 * 1000,
  cookie: 'bs_session',
};

/**
 * Cookies get the Secure flag unless COOKIE_SECURE=false, or the site is opened on
 * localhost during development.
 */
export function secureCookies(hostname: string): boolean {
  if (process.env.COOKIE_SECURE === 'false') return false;
  return !['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
