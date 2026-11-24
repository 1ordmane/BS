import { ru, type SiteContent } from './ru';
import type { Locale } from './types';

export type { SiteContent };

const content: Record<Locale, SiteContent> = { ru };

export const defaultLocale: Locale = 'ru';

/**
 * Content for a locale. Components pass `Astro.currentLocale`, which Astro derives from the URL
 * (/en/... once `en` is configured). Add `en` to Locale, to the map above and to `i18n.locales`
 * in astro.config.mjs to publish an English version.
 */
export function getContent(locale: string | undefined = defaultLocale): SiteContent {
  return content[locale as Locale] ?? content[defaultLocale];
}
