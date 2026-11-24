import type { ImageKey } from './images';

export type Locale = 'ru';

/** A value the company has not confirmed yet. Rendered as a visible, clearly marked placeholder. */
export interface Placeholder {
  placeholder: string;
}

export type Fact = string | Placeholder;

export const isPlaceholder = (value: Fact): value is Placeholder =>
  typeof value === 'object' && value !== null && 'placeholder' in value;

export interface NavItem {
  label: string;
  href: string;
  /** Opens the portfolio menu (PortfolioSheet) instead of following the link, when JavaScript runs. */
  portfolio?: boolean;
}

export interface Picture {
  image: ImageKey;
  alt: string;
}

export interface HighlightCard {
  id: string;
  title: string;
  text: string;
  icon: string;
  href: string;
}

export interface Service {
  id: string;
  title: string;
  text: string;
  picture: Picture;
}

export interface ProjectCategory {
  id: string;
  label: string;
  /** Compact label for filter buttons. */
  short: string;
}

export interface Project {
  slug: string;
  title: string;
  category: string;
  summary: string;
  client: Fact;
  event: Fact;
  area: Fact;
  year: Fact;
  picture: Picture;
  /** Paragraphs for the project page. */
  story: { heading: string; text: string }[];
  scope: string[];
  /** True while the project uses stock imagery and sample data instead of a real case. */
  illustrative: boolean;
}

export interface Stage {
  number: string;
  title: string;
  text: string;
}

export interface Principle {
  title: string;
  text: string;
}

export interface ContactChannel {
  label: string;
  value: Fact;
  href?: string;
}
