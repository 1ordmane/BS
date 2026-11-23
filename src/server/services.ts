import { all, logActivity, now, one, run, tx } from './db.ts';
import { NotFoundError, ValidationError } from './errors.ts';
import { getImage } from './images.ts';
import { Fields, slugify } from './validate.ts';

export interface ServiceRow {
  id: number;
  anchor: string;
  title: string;
  summary: string;
  details: string;
  image_id: string | null;
  position: number;
  published: number;
  created_at: string;
  updated_at: string;
}

function parse(input: unknown, id: number | null): Omit<ServiceRow, 'id' | 'position' | 'created_at' | 'updated_at'> {
  const f = new Fields(input);
  const title = f.text('title', { required: true, max: 80 });
  const raw = f.slug('anchor');
  // Anchors become element ids on the homepage (#service-…), so they carry a fixed prefix.
  const anchor = raw || (title ? `service-${slugify(title)}` : '');
  const imageValue = f.raw('image_id');
  let image_id: string | null = null;
  if (typeof imageValue === 'string' && imageValue) {
    const image = getImage(imageValue);
    if (!image || image.kind !== 'media') f.fail('image_id', 'Изображение не найдено в медиатеке');
    else image_id = image.id;
  }
  const data = {
    anchor,
    title,
    summary: f.text('summary', { required: true, max: 160 }),
    details: f.text('details', { max: 2000, multiline: true }),
    image_id,
    published: f.bool('published') ? 1 : 0,
  };
  if (data.published && !data.image_id) f.fail('image_id', 'У опубликованной услуги должно быть изображение');
  const taken = anchor ? one<{ id: number }>('SELECT id FROM services WHERE anchor = ?', anchor) : undefined;
  if (taken && taken.id !== id) f.fail('anchor', 'Такой якорь уже есть у другой услуги');
  f.finish();
  return data;
}

export function listServices(publishedOnly = false): ServiceRow[] {
  return all<ServiceRow>(`SELECT * FROM services ${publishedOnly ? 'WHERE published = 1' : ''} ORDER BY position, id`);
}

export function getService(id: number): ServiceRow {
  const row = one<ServiceRow>('SELECT * FROM services WHERE id = ?', id);
  if (!row) throw new NotFoundError('Услуга не найдена');
  return row;
}

export function createService(input: unknown, userId: number | null): ServiceRow {
  return tx(() => {
    const data = parse(input, null);
    const position = one<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM services')!.p;
    const time = now();
    const { lastInsertRowid } = run(
      `INSERT INTO services (anchor, title, summary, details, image_id, published, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.anchor,
      data.title,
      data.summary,
      data.details,
      data.image_id,
      data.published,
      position,
      time,
      time,
    );
    logActivity(userId, 'service.create', `Добавлена услуга «${data.title}»`);
    return getService(lastInsertRowid);
  });
}

export function updateService(id: number, input: unknown, userId: number | null): ServiceRow {
  return tx(() => {
    getService(id);
    const data = parse(input, id);
    run(
      'UPDATE services SET anchor = ?, title = ?, summary = ?, details = ?, image_id = ?, published = ?, updated_at = ? WHERE id = ?',
      data.anchor,
      data.title,
      data.summary,
      data.details,
      data.image_id,
      data.published,
      now(),
      id,
    );
    logActivity(userId, 'service.update', `Изменена услуга «${data.title}»`);
    return getService(id);
  });
}

export function deleteService(id: number, userId: number | null): void {
  const service = getService(id);
  run('DELETE FROM services WHERE id = ?', id);
  logActivity(userId, 'service.delete', `Удалена услуга «${service.title}»`);
}

export function reorderServices(ids: unknown, userId: number | null): ServiceRow[] {
  if (!Array.isArray(ids)) throw new ValidationError({ order: 'Неверный порядок' });
  return tx(() => {
    const current = listServices().map((s) => s.id);
    const next = ids.map(Number);
    const same = next.length === current.length && new Set(next).size === next.length && current.every((id) => next.includes(id));
    if (!same) throw new ValidationError({ order: 'Список услуг изменился. Обновите страницу.' });
    next.forEach((id, index) => run('UPDATE services SET position = ? WHERE id = ?', index, id));
    logActivity(userId, 'service.reorder', 'Изменён порядок услуг');
    return listServices();
  });
}
