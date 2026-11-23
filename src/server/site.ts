import { ru } from '../data/ru.ts';
import { getDraft, getPublished, readFeatured, type AboutDoc, type CompanyDoc, type HomepageDoc } from './content.ts';
import { all } from './db.ts';
import { getImageView, listProjectImages, toView, type ImageView } from './images.ts';
import { descriptionSections, listPublished, scopeItems, type ProjectRow } from './projects.ts';
import { listServices } from './services.ts';

/**
 * What the public templates render: published content, or the drafts when an
 * administrator previews pending changes.
 */

export type Stage = 'published' | 'draft';

/**
 * How many projects the homepage viewer shows: the first published ones from the
 * admin's selection. Further selected projects wait in reserve and move up when one of
 * the first is unpublished or deleted.
 */
export const HOMEPAGE_PROJECTS = 6;

export interface ProjectCardView {
  id: number;
  slug: string;
  title: string;
  category: string;
  categoryLabel: string;
  /** Filled in by the admin; empty when not confirmed (never invented). */
  client: string;
  event: string;
  area: string;
  illustrative: boolean;
  cover: ImageView | null;
}

export interface ServiceView {
  anchor: string;
  title: string;
  summary: string;
  image: ImageView | null;
}

export interface SiteView {
  stage: Stage;
  company: CompanyDoc;
  homepage: HomepageDoc;
  about: AboutDoc;
  images: {
    hero: ImageView | null;
    contact: ImageView | null;
    aboutMain: ImageView | null;
    aboutSecondary: ImageView | null;
  };
  services: ServiceView[];
  featured: ProjectCardView[];
}

const categoryLabel = (id: string) => ru.projectCategories.find((c) => c.id === id)?.label ?? '';

export function toCard(project: ProjectRow): ProjectCardView {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    category: project.category,
    categoryLabel: categoryLabel(project.category),
    client: project.client,
    event: project.event,
    area: project.area,
    illustrative: project.illustrative === 1,
    cover: getImageView(project.cover_image_id),
  };
}

export function buildSite(stage: Stage = 'published'): SiteView {
  const doc = <K extends 'homepage' | 'about' | 'company'>(key: K) => (stage === 'draft' ? getDraft(key).doc : getPublished(key));
  const homepage = doc('homepage');
  const about = doc('about');
  const company = doc('company');

  // Only published projects are ever shown, even in the preview of a draft selection.
  const ids = readFeatured(stage);
  const projects = ids.length
    ? all<ProjectRow>(`SELECT * FROM projects WHERE status = 'published' AND id IN (${ids.map(() => '?').join(',')})`, ...ids)
    : [];
  const byId = new Map(projects.map((p) => [p.id, p]));
  const featured = ids.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!)] : [])).slice(0, HOMEPAGE_PROJECTS);

  return {
    stage,
    company,
    homepage,
    about,
    images: {
      hero: getImageView(homepage.hero.imageId, homepage.hero.imageAlt),
      contact: getImageView(homepage.contact.imageId, homepage.contact.imageAlt),
      aboutMain: getImageView(about.about.mainImageId, about.about.mainAlt),
      aboutSecondary: getImageView(about.about.secondaryImageId, about.about.secondaryAlt),
    },
    services: listServices(true).map((s) => ({ anchor: s.anchor, title: s.title, summary: s.summary, image: getImageView(s.image_id) })),
    featured,
  };
}

export function publishedCards(): ProjectCardView[] {
  return listPublished().map(toCard);
}

export interface ProjectPageView {
  project: ProjectRow;
  categoryLabel: string;
  cover: ImageView | null;
  gallery: ImageView[];
  sections: { heading: string; paragraphs: string[] }[];
  scope: string[];
  next: { slug: string; title: string } | null;
}

export function projectPage(project: ProjectRow): ProjectPageView {
  const images = listProjectImages(project.id).map((row) => toView(row));
  const cover = images.find((image) => image.id === project.cover_image_id) ?? images[0] ?? null;
  const published = listPublished();
  const index = published.findIndex((p) => p.id === project.id);
  const nextProject = published.length > 1 ? published[(index + 1) % published.length] : null;
  return {
    project,
    categoryLabel: categoryLabel(project.category),
    cover,
    gallery: images.filter((image) => image.id !== cover?.id),
    sections: descriptionSections(project.description),
    scope: scopeItems(project.scope),
    next: nextProject && nextProject.id !== project.id ? { slug: nextProject.slug, title: nextProject.title } : null,
  };
}
