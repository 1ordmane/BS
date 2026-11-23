// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Replace with the production domain before deploying (used for canonical URLs and Open Graph).
const SITE_URL = process.env.SITE_URL ?? 'https://business-stand.example';

export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'ignore',
  // Pages are rendered on the server: the content comes from the database the admin panel edits.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  security: {
    // Rejects cross-site form posts (CSRF) to every endpoint.
    checkOrigin: true,
    // Host names the server answers to. Astro only trusts the Host header for these, and needs
    // it to know its own origin for the check above. Extra names: ALLOWED_HOSTS=a.ru,www.a.ru
    allowedDomains: [
      new URL(SITE_URL).hostname,
      ...(process.env.ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean),
      'localhost',
      '127.0.0.1',
    ].map((hostname) => ({ hostname })),
  },
  i18n: {
    defaultLocale: 'ru',
    locales: ['ru'],
  },
  image: {
    responsiveStyles: false,
  },
  vite: {
    ssr: {
      external: ['sharp'],
    },
  },
});
