import fs from 'node:fs';
import path from 'node:path';
import { ru } from '../data/ru.ts';
import { paths } from './config.ts';
import { all, logActivity, now, one, run, tx } from './db.ts';
import { ConflictError, NotFoundError, UserError, ValidationError } from './errors.ts';
import { listProjectImages, type ImageRow } from './images.ts';
import { Fields, slugify } from './validate.ts';

export const CATEGORY_IDS = ru.projectCategories.map((c) => c.id);

export interface ProjectRow {
  id: number;
  slug: string;
  title: string;
  category: string;
  client: string;
  event: string;
  location: string;
  area: string;
  year: string;
  summary: string;
  description: string;
  scope: string;
  illustrative: number;
  cover_image_id: string | null;
  status: 'draft' | 'published';
  seo_title: string;
  seo_description: string;
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

/** Fields an administrator edits in the form (and that revisions store). */
const EDITABLE = [
  'slug',
  'title',
  'category',
  'client',
  'event',
  'location',
  'area',
  'year',
  'summary',
  'description',
  'scope',
  'illustrative',
  'seo_title',
  'seo_description',
] as const;

type Editable = Pick<ProjectRow, (typeof EDITABLE)[number]>;

export function parseProjectInput(input: unknown): Editable {
  const f = new Fields(input);
  const title = f.text('title', { required: true, max: 140 });
  let slug = f.slug('slug');
  if (!slug && title) slug = slugify(title);
  if (!slug && title) f.fail('slug', 'Укажите адрес латиницей, например island-stand');
  const data: Editable = {
    slug,
    title,
    category: f.oneOf('category', CATEGORY_IDS),
    client: f.text('client', { max: 120 }),
    event: f.text('event', { max: 160 }),
    location: f.text('location', { max: 120 }),
    area: f.text('area', { max: 40 }),
    year: f.text('year', { max: 20 }),
    summary: f.text('summary', { max: 300 }),
    description: f.text('description', { max: 10_000, multiline: true }),
    scope: f.text('scope', { max: 2_000, multiline: true }),
    illustrative: f.bool('illustrative') ? 1 : 0,
    seo_title: f.text('seo_title', { max: 120 }),
    seo_description: f.text('seo_description', { max: 300 }),
  };
  f.finish();
  return data;
}

function assertSlugFree(slug: string, projectId: number | null): void {
  const taken = one<{ id: number }>('SELECT id FROM projects WHERE slug = ?', slug);
  if (taken && taken.id !== projectId) throw new ValidationError({ slug: 'Этот адрес уже занят другим проектом' });
  const redirect = one<{ project_id: number }>('SELECT project_id FROM slug_redirects WHERE slug = ?', slug);
  if (redirect && redirect.project_id !== projectId) {
    throw new ValidationError({ slug: 'Этот адрес раньше принадлежал другому проекту и перенаправляет на него' });
  }
}

export function getProject(id: number): ProjectRow | undefined {
  return one<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
}

export function requireProject(id: number): ProjectRow {
  const project = getProject(id);
  if (!project) throw new NotFoundError('Проект не найден');
  return project;
}

/** Public lookup. Returns the project, or the slug it moved to. */
export function findPublishedBySlug(slug: string): { project?: ProjectRow; movedTo?: string } {
  const project = one<ProjectRow>("SELECT * FROM projects WHERE slug = ? AND status = 'published'", slug);
  if (project) return { project };
  const moved = one<{ slug: string }>(
    `SELECT p.slug FROM slug_redirects r JOIN projects p ON p.id = r.project_id
     WHERE r.slug = ? AND p.status = 'published'`,
    slug,
  );
  return moved ? { movedTo: moved.slug } : {};
}

export function listPublished(): ProjectRow[] {
  return all<ProjectRow>("SELECT * FROM projects WHERE status = 'published' ORDER BY published_at DESC, id DESC");
}

export interface ProjectQuery {
  q?: string;
  status?: string;
  category?: string;
  sort?: string;
  dir?: string;
}

const SORTS: Record<string, string> = {
  updated: 'updated_at',
  created: 'created_at',
  title: 'title COLLATE NOCASE',
  status: 'status',
};

export function listProjects(query: ProjectQuery = {}): (ProjectRow & { images: number })[] {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = (query.q ?? '').trim().slice(0, 100);
  if (q) {
    where.push(`(${['title', 'client', 'event', 'slug'].map((col) => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like, like);
  }
  if (query.status === 'draft' || query.status === 'published') {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.category && CATEGORY_IDS.includes(query.category)) {
    where.push('category = ?');
    params.push(query.category);
  }
  const order = SORTS[query.sort ?? ''] ?? SORTS.updated!;
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  const sql = `SELECT p.*, (SELECT COUNT(*) FROM images i WHERE i.project_id = p.id) AS images
    FROM projects p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${order} ${dir}, id DESC`;
  return all(sql, ...params);
}

export function createProject(input: unknown, userId: number | null): ProjectRow {
  const data = parseProjectInput(input);
  return tx(() => {
    assertSlugFree(data.slug, null);
    const time = now();
    const { lastInsertRowid } = run(
      `INSERT INTO projects (${EDITABLE.join(', ')}, status, version, created_at, updated_at)
       VALUES (${EDITABLE.map(() => '?').join(', ')}, 'draft', 1, ?, ?)`,
      ...EDITABLE.map((key) => data[key]),
      time,
      time,
    );
    logActivity(userId, 'project.create', `Создан проект «${data.title}»`);
    return getProject(lastInsertRowid)!;
  });
}

function snapshot(project: ProjectRow): string {
  return JSON.stringify(Object.fromEntries(EDITABLE.map((key) => [key, project[key]])));
}

/**
 * Saves the form. expectedVersion is the version the editor loaded; if someone saved in the
 * meantime the save is refused instead of silently overwriting their changes.
 */
export function updateProject(id: number, input: unknown, expectedVersion: unknown, userId: number | null): ProjectRow {
  const data = parseProjectInput(input);
  return tx(() => {
    const current = requireProject(id);
    if (Number(expectedVersion) !== current.version) throw new ConflictError();
    assertSlugFree(data.slug, id);

    const before = snapshot(current);
    const changed = EDITABLE.some((key) => data[key] !== current[key]);
    if (!changed) return current;

    run(
      'INSERT INTO project_revisions (project_id, data, created_at, user_id) VALUES (?, ?, ?, ?)',
      id,
      before,
      now(),
      userId,
    );
    run(
      `DELETE FROM project_revisions WHERE project_id = ? AND id NOT IN
       (SELECT id FROM project_revisions WHERE project_id = ? ORDER BY id DESC LIMIT 30)`,
      id,
      id,
    );

    if (data.slug !== current.slug) {
      // Keep the old address working for anyone who shared or indexed it.
      if (current.status === 'published' || current.published_at) {
        run('INSERT OR REPLACE INTO slug_redirects (slug, project_id) VALUES (?, ?)', current.slug, id);
      }
      run('DELETE FROM slug_redirects WHERE slug = ?', data.slug);
    }

    run(
      `UPDATE projects SET ${EDITABLE.map((key) => `${key} = ?`).join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`,
      ...EDITABLE.map((key) => data[key]),
      now(),
      id,
    );
    logActivity(userId, 'project.update', `Изменён проект «${data.title}»`);
    return getProject(id)!;
  });
}

/** Reasons a project cannot be published yet. */
export function publishProblems(project: ProjectRow): string[] {
  const problems: string[] = [];
  if (!project.title) problems.push('нет названия');
  if (!project.summary) problems.push('нет краткого описания');
  if (!project.cover_image_id) problems.push('нет обложки — загрузите хотя бы одно фото');
  return problems;
}

export function setStatus(id: number, status: 'draft' | 'published', userId: number | null): ProjectRow {
  return tx(() => {
    const project = requireProject(id);
    if (status === 'published') {
      const problems = publishProblems(project);
      if (problems.length) throw new UserError(`Проект нельзя опубликовать: ${problems.join('; ')}.`, 422);
    }
    if (project.status === status) return project;
    const time = now();
    run(
      `UPDATE projects SET status = ?, version = version + 1, updated_at = ?,
       published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END WHERE id = ?`,
      status,
      time,
      status,
      time,
      id,
    );
    logActivity(userId, `project.${status === 'published' ? 'publish' : 'unpublish'}`, `${status === 'published' ? 'Опубликован' : 'Снят с публикации'} проект «${project.title}»`);
    return getProject(id)!;
  });
}

export function deleteProject(id: number, userId: number | null): void {
  const images: ImageRow[] = listProjectImages(id);
  const project = requireProject(id);
  tx(() => {
    // Images, revisions, redirects and homepage selections go with it (ON DELETE CASCADE).
    run('DELETE FROM projects WHERE id = ?', id);
    logActivity(userId, 'project.delete', `Удалён проект «${project.title}»`);
  });
  for (const image of images) fs.rmSync(path.join(paths.media(), image.id), { recursive: true, force: true });
}

export function listRevisions(id: number): { id: number; created_at: string; title: string; user: string | null }[] {
  return all<{ id: number; created_at: string; data: string; user: string | null }>(
    `SELECT r.id, r.created_at, r.data, u.email AS user FROM project_revisions r
     LEFT JOIN users u ON u.id = r.user_id WHERE r.project_id = ? ORDER BY r.id DESC`,
    id,
  ).map((row) => ({ id: row.id, created_at: row.created_at, user: row.user, title: (JSON.parse(row.data) as Editable).title }));
}

/** Puts an earlier version of the texts back. The current texts become a revision themselves. */
export function restoreRevision(id: number, revisionId: number, userId: number | null): ProjectRow {
  const revision = one<{ data: string }>('SELECT data FROM project_revisions WHERE id = ? AND project_id = ?', revisionId, id);
  if (!revision) throw new NotFoundError('Версия не найдена');
  const project = requireProject(id);
  const data = JSON.parse(revision.data) as Editable;
  // A slug taken by another project since then keeps the current one.
  const slugTaken = one<{ id: number }>('SELECT id FROM projects WHERE slug = ? AND id != ?', data.slug, id);
  return updateProject(id, { ...data, slug: slugTaken ? project.slug : data.slug, illustrative: data.illustrative === 1 }, project.version, userId);
}

/** Splits the description into sections: lines starting with "## " become headings. */
export function descriptionSections(text: string): { heading: string; paragraphs: string[] }[] {
  const sections: { heading: string; paragraphs: string[] }[] = [];
  let current: { heading: string; paragraphs: string[] } | null = null;
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (line.startsWith('## ')) {
        current = { heading: line.slice(3).trim(), paragraphs: [] };
        sections.push(current);
        continue;
      }
      const paragraph = lines.slice(i).join(' ').trim();
      if (paragraph) {
        if (!current) {
          current = { heading: '', paragraphs: [] };
          sections.push(current);
        }
        current.paragraphs.push(paragraph);
      }
      break;
    }
  }
  return sections;
}

export function scopeItems(scope: string): string[] {
  return scope
    .split('\n')
    .map((line) => line.replace(/^[-–•*]\s*/, '').trim())
    .filter(Boolean);
}
