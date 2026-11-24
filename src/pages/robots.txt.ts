import type { APIRoute } from 'astro';

/** Lets search engines index the public site, keeps them out of the admin panel and the API. */
export const GET: APIRoute = ({ site, url }) => {
  const origin = (site ?? url).origin;
  const body = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api/', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
