import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { limits, paths } from './config.ts';
import { all, now, one, run, tx } from './db.ts';
import { NotFoundError, UserError, ValidationError } from './errors.ts';
import { cleanText } from './validate.ts';

/**
 * Uploaded images are decoded and re-encoded by sharp: this rejects anything that is not
 * really an image, applies EXIF rotation and drops metadata (GPS and camera data).
 * Each image gets WebP copies at several widths, a thumbnail and a 1200×630 JPEG for
 * link previews. Files are named by a random id, never by the uploaded name.
 */

const WIDTHS = [480, 960, 1440, 2400];
const THUMB_WIDTH = 360;
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'avif']);

export interface ImageRow {
  id: string;
  kind: 'project' | 'media';
  project_id: number | null;
  position: number;
  alt: string;
  width: number;
  height: number;
  widths: string;
  bytes: number;
  original_name: string;
  created_at: string;
}

export interface ImageView {
  id: string;
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
  thumb: string;
  og: string;
}

const ID_PATTERN = /^[a-f0-9]{24}$/;
const FILE_PATTERN = /^(w\d{3,4}\.webp|thumb\.webp|og\.jpg)$/;

export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function mediaFilePath(id: string, file: string): string | null {
  if (!ID_PATTERN.test(id) || !FILE_PATTERN.test(file)) return null;
  return path.join(paths.media(), id, file);
}

export function toView(row: ImageRow, alt?: string): ImageView {
  const widths = JSON.parse(row.widths) as number[];
  const base = `/media/${row.id}`;
  return {
    id: row.id,
    src: `${base}/w${widths[widths.length - 1]}.webp`,
    srcset: widths.map((w) => `${base}/w${w}.webp ${w}w`).join(', '),
    width: row.width,
    height: row.height,
    alt: alt ?? row.alt,
    thumb: `${base}/thumb.webp`,
    og: `${base}/og.jpg`,
  };
}

export function getImage(id: string): ImageRow | undefined {
  if (!isImageId(id)) return undefined;
  return one<ImageRow>('SELECT * FROM images WHERE id = ?', id);
}

export function getImageView(id: string | null | undefined, alt?: string): ImageView | null {
  if (!id) return null;
  const row = getImage(id);
  return row ? toView(row, alt) : null;
}

/** Decodes, validates and writes all variants. Returns dimensions; throws a readable error otherwise. */
async function writeVariants(buffer: Buffer, id: string): Promise<{ width: number; height: number; widths: number[] }> {
  if (buffer.length === 0) throw new UserError('Файл пустой');
  if (buffer.length > limits.imageBytes) throw new UserError(`Файл больше ${limits.imageBytes / 1024 / 1024} МБ`, 413);

  let meta: Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: limits.imagePixels }).metadata();
  } catch {
    throw new UserError('Это не изображение или файл повреждён. Загрузите JPG, PNG, WebP или AVIF.', 415);
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw new UserError('Формат не поддерживается. Загрузите JPG, PNG, WebP или AVIF.', 415);
  }

  const rotated = sharp(buffer, { limitInputPixels: limits.imagePixels, failOn: 'error' }).rotate();
  const { data: normalized, info } = await rotated.toBuffer({ resolveWithObject: true });
  if (info.width < 200 || info.height < 200) throw new UserError('Изображение слишком маленькое: нужно хотя бы 200 × 200 пикселей');

  const widths = WIDTHS.filter((w) => w < info.width);
  widths.push(Math.min(info.width, WIDTHS[WIDTHS.length - 1]!));

  const finalDir = path.join(paths.media(), id);
  const tempDir = path.join(paths.media(), `.tmp-${id}`);
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    const source = () => sharp(normalized, { limitInputPixels: limits.imagePixels });
    for (const w of widths) {
      await source().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(tempDir, `w${w}.webp`));
    }
    await source().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(tempDir, 'thumb.webp'));
    await source().resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(tempDir, 'og.jpg'));
    fs.renameSync(tempDir, finalDir);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (error instanceof UserError) throw error;
    throw new UserError('Не удалось обработать изображение. Попробуйте другой файл.', 422);
  }
  return { width: info.width, height: info.height, widths };
}

function removeFiles(id: string): void {
  if (!ID_PATTERN.test(id)) return;
  try {
    fs.rmSync(path.join(paths.media(), id), { recursive: true, force: true });
  } catch (error) {
    // The database row is already gone; sweepOrphanMedia() removes leftovers later.
    console.error(`Could not remove media files for ${id}`, error);
  }
}

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  alt?: string;
}

/** Adds an image to a project's gallery (at the end) and makes it the cover if there is none. */
export async function addProjectImage(projectId: number, input: UploadInput): Promise<ImageRow> {
  if (!one('SELECT id FROM projects WHERE id = ?', projectId)) throw new NotFoundError('Проект не найден');
  const id = crypto.randomBytes(12).toString('hex');
  const size = await writeVariants(input.buffer, id);
  try {
    return tx(() => {
      // The project may have been deleted while the file was processed.
      if (!one('SELECT id FROM projects WHERE id = ?', projectId)) throw new NotFoundError('Проект удалён');
      const next = one<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM images WHERE project_id = ?', projectId)!.p;
      insertRow(id, 'project', projectId, next, input, size);
      run('UPDATE projects SET cover_image_id = ? WHERE id = ? AND cover_image_id IS NULL', id, projectId);
      return getImage(id)!;
    });
  } catch (error) {
    removeFiles(id);
    throw error;
  }
}

/** Adds an image to the shared library used by the homepage and services. */
export async function addMediaImage(input: UploadInput): Promise<ImageRow> {
  const id = crypto.randomBytes(12).toString('hex');
  const size = await writeVariants(input.buffer, id);
  try {
    insertRow(id, 'media', null, 0, input, size);
    return getImage(id)!;
  } catch (error) {
    removeFiles(id);
    throw error;
  }
}

function insertRow(
  id: string,
  kind: 'project' | 'media',
  projectId: number | null,
  position: number,
  input: UploadInput,
  size: { width: number; height: number; widths: number[] },
): void {
  run(
    `INSERT INTO images (id, kind, project_id, position, alt, width, height, widths, bytes, original_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    kind,
    projectId,
    position,
    cleanText(input.alt ?? '', false).slice(0, 300),
    size.width,
    size.height,
    JSON.stringify(size.widths),
    input.buffer.length,
    cleanText(path.basename(input.originalName), false).slice(0, 200),
    now(),
  );
}

export function listProjectImages(projectId: number): ImageRow[] {
  return all<ImageRow>('SELECT * FROM images WHERE project_id = ? ORDER BY position, created_at', projectId);
}

/** Saves a new gallery order. The list must contain exactly the project's images. */
export function reorderProjectImages(projectId: number, ids: unknown): ImageRow[] {
  if (!Array.isArray(ids) || !ids.every(isImageId)) throw new ValidationError({ order: 'Неверный порядок изображений' });
  return tx(() => {
    const current = listProjectImages(projectId).map((row) => row.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length || unique.size !== current.length || current.some((id) => !unique.has(id))) {
      throw new UserError('Галерея изменилась, пока вы её редактировали. Порядок обновлён с сервера.', 409);
    }
    ids.forEach((id, index) => run('UPDATE images SET position = ? WHERE id = ?', index, id));
    return listProjectImages(projectId);
  });
}

export function setImageAlt(id: string, alt: unknown): ImageRow {
  const row = getImage(id);
  if (!row) throw new NotFoundError('Изображение не найдено');
  const text = cleanText(alt, false);
  if (text.length > 300) throw new ValidationError({ alt: 'Не длиннее 300 символов' });
  run('UPDATE images SET alt = ? WHERE id = ?', text, id);
  return getImage(id)!;
}

export function setProjectCover(projectId: number, imageId: string): void {
  const row = getImage(imageId);
  if (!row || row.project_id !== projectId) throw new NotFoundError('Изображение не найдено в этом проекте');
  run('UPDATE projects SET cover_image_id = ?, updated_at = ? WHERE id = ?', imageId, now(), projectId);
}

/** Lists where a library image is used, so it is not deleted while in use. */
export function mediaUsage(id: string): string[] {
  const usage: string[] = [];
  for (const service of all<{ title: string }>('SELECT title FROM services WHERE image_id = ?', id)) {
    usage.push(`услуга «${service.title}»`);
  }
  for (const doc of all<{ key: string; draft: string; published: string | null }>('SELECT key, draft, published FROM content_docs')) {
    if (doc.draft.includes(id) || doc.published?.includes(id)) usage.push(`раздел «${docTitles[doc.key] ?? doc.key}»`);
  }
  return usage;
}

const docTitles: Record<string, string> = { homepage: 'Главная', about: 'О компании', company: 'Настройки' };

export function deleteImage(id: string): void {
  const row = getImage(id);
  if (!row) throw new NotFoundError('Изображение не найдено');
  tx(() => {
    if (row.kind === 'media') {
      const usage = mediaUsage(id);
      if (usage.length) throw new UserError(`Изображение используется: ${usage.join(', ')}. Сначала замените его там.`, 409);
    }
    run('DELETE FROM images WHERE id = ?', id);
    if (row.project_id !== null) {
      // Keep positions contiguous and give the project a new cover if it lost its own.
      listProjectImages(row.project_id).forEach((image, index) => run('UPDATE images SET position = ? WHERE id = ?', index, image.id));
      const first = listProjectImages(row.project_id)[0];
      if (first) run('UPDATE projects SET cover_image_id = ? WHERE id = ? AND cover_image_id IS NULL', first.id, row.project_id);
    }
  });
  removeFiles(id);
}

export function listMedia(): ImageRow[] {
  return all<ImageRow>("SELECT * FROM images WHERE kind = 'media' ORDER BY created_at DESC");
}

/** Removes media folders that no database row refers to (left by crashes or failed deletes). */
export function sweepOrphanMedia(): number {
  const dir = paths.media();
  if (!fs.existsSync(dir)) return 0;
  const known = new Set(all<{ id: string }>('SELECT id FROM images').map((row) => row.id));
  // Uploads in progress write their folder before the database row; leave recent folders alone.
  const cutoff = Date.now() - 10 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    const orphan = entry.startsWith('.tmp-') || (ID_PATTERN.test(entry) && !known.has(entry));
    if (orphan && fs.statSync(path.join(dir, entry)).mtimeMs < cutoff) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}
