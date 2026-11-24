import type { APIRoute } from 'astro';
import { publishedCards } from '@/server/site';

/**
 * The public pages for search engines: home, the catalogue, every published project and the
 * legal pages. Built from the database on each request, so a project published in the admin
 * panel appears here at once. Addresses use SITE_URL (astro.config.mjs).
 */
export const GET: APIRoute = ({ site, url }) => {
  const origin = (site ?? url).origin;
  const paths = ['/', '/projects/', ...publishedCards().map((card) => `/projects/${card.slug}/`), '/privacy/', '/consent/'];
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => `  <url><loc>${escape(new URL(path, origin).href)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
