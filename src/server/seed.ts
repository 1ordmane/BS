import fs from 'node:fs';
import path from 'node:path';
import { ru } from '../data/ru.ts';
import { defaultDoc, initDoc } from './content.ts';
import { now, one, run, tx } from './db.ts';
import { addMediaImage, addProjectImage } from './images.ts';

/**
 * Fills an empty database with the content the site launched with (src/data/ru.ts and
 * the photos in src/assets/images), so nothing disappears when the site switches to the
 * database. Runs once; an existing database is never touched.
 */

const SOURCE_DIR = path.join(process.cwd(), 'src', 'assets', 'images');

const files: Record<string, string> = {
  heroExhibition: 'hero-exhibition.jpg',
  aboutSpace: 'about-space.jpg',
  aboutHall: 'about-hall.jpg',
  contactDetail: 'contact-detail.jpg',
  serviceDesign: 'service-design.jpg',
  service3d: 'service-3d.jpg',
  serviceFabrication: 'service-fabrication.jpg',
  serviceInstallation: 'service-installation.jpg',
  serviceLighting: 'service-lighting.jpg',
  serviceLogistics: 'service-logistics.jpg',
  projectIsland: 'project-island.jpg',
  projectCorner: 'project-corner.jpg',
  projectPavilion: 'project-pavilion.jpg',
  projectModular: 'project-modular.jpg',
  projectProduct: 'project-product.jpg',
  projectInternational: 'project-international.jpg',
};

function readSource(key: string): { buffer: Buffer; originalName: string } | null {
  const name = files[key];
  if (!name) return null;
  const file = path.join(SOURCE_DIR, name);
  return fs.existsSync(file) ? { buffer: fs.readFileSync(file), originalName: name } : null;
}

async function media(key: string, alt: string): Promise<string | undefined> {
  const source = readSource(key);
  if (!source) return undefined;
  return (await addMediaImage({ ...source, alt })).id;
}

export function isSeeded(): boolean {
  return !!one('SELECT key FROM content_docs LIMIT 1');
}

let running: Promise<boolean> | null = null;

/** Seeds once per process; concurrent callers share the same run. Returns true if it seeded. */
export function seedIfEmpty(): Promise<boolean> {
  running ??= seed().finally(() => {
    running = null;
  });
  return running;
}

async function seed(): Promise<boolean> {
  if (isSeeded()) return false;

  const images = {
    hero: await media('heroExhibition', ru.hero.imageAlt),
    contact: await media('contactDetail', ru.contact.imageAlt),
    aboutMain: await media(ru.about.images.main.image, ru.about.images.main.alt),
    aboutSecondary: await media(ru.about.images.secondary.image, ru.about.images.secondary.alt),
  };

  const serviceImages: (string | undefined)[] = [];
  for (const service of ru.services) serviceImages.push(await media(service.picture.image, service.picture.alt));

  // Projects first as rows, then their photos (photos need the project id).
  // A database that already has projects (an interrupted earlier run) keeps them.
  const projectIds: number[] = [];
  const hasProjects = !!one('SELECT id FROM projects LIMIT 1');
  if (!hasProjects) tx(() => {
    const time = now();
    for (const project of ru.projects) {
      const description = project.story.map((part) => `## ${part.heading}\n\n${part.text}`).join('\n\n');
      const { lastInsertRowid } = run(
        `INSERT INTO projects (slug, title, category, summary, description, scope, illustrative, status, created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
        project.slug,
        project.title,
        project.category,
        project.summary,
        description,
        project.scope.join('\n'),
        project.illustrative ? 1 : 0,
        time,
        time,
      );
      projectIds.push(lastInsertRowid);
    }
  });
  for (const [index, project] of ru.projects.entries()) {
    const source = readSource(project.picture.image);
    if (source) await addProjectImage(projectIds[index]!, { ...source, alt: project.picture.alt });
  }

  tx(() => {
    if (isSeeded()) return;
    const time = now();
    // Projects with a photo go live, as they were on the site before.
    for (const id of projectIds) {
      run("UPDATE projects SET status = 'published', published_at = ? WHERE id = ? AND cover_image_id IS NOT NULL", time, id);
    }
    if (!one('SELECT id FROM services LIMIT 1')) ru.services.forEach((service, index) => {
      const imageId = serviceImages[index] ?? null;
      run(
        `INSERT INTO services (anchor, title, summary, image_id, position, published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        service.id,
        service.title,
        service.text,
        imageId,
        index,
        imageId ? 1 : 0,
        time,
        time,
      );
    });
    initDoc('homepage', defaultDoc('homepage', images));
    initDoc('about', defaultDoc('about', images));
    initDoc('company', defaultDoc('company'));
    const published = projectIds.filter((id) => one("SELECT id FROM projects WHERE id = ? AND status = 'published'", id));
    published.forEach((id, index) => {
      run("INSERT INTO featured_projects (stage, project_id, position) VALUES ('draft', ?, ?)", id, index);
      run("INSERT INTO featured_projects (stage, project_id, position) VALUES ('published', ?, ?)", id, index);
    });
  });
  return true;
}
