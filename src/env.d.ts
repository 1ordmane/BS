/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Signed-in administrator, for /admin, /api/admin and /media requests. */
    session: import('./server/auth.ts').Session | null;
    /** Content the public templates render: published, or drafts in an admin preview. */
    site: import('./server/site.ts').SiteView;
  }
}
