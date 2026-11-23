import { MESSENGER_DEFAULTS, normalizePhone } from '../data/messengers.ts';
import { ru } from '../data/ru.ts';
import { all, logActivity, now, one, run, tx } from './db.ts';
import { ConflictError, NotFoundError, UserError, ValidationError } from './errors.ts';
import { getImage } from './images.ts';
import { Fields } from './validate.ts';

/**
 * Editable text blocks. Each document has a draft (what the admin edits and previews)
 * and a published copy (what visitors see). Publishing is an explicit action and
 * only copies that one document, so unrelated content never changes along with it.
 */

export const HIGHLIGHT_ICONS = [
  'DraftingCompass',
  'Construction',
  'Workflow',
  'Ruler',
  'PenTool',
  'Layers',
  'Box',
  'Hammer',
  'Lightbulb',
  'Truck',
  'Presentation',
  'Handshake',
] as const;

export interface HomepageDoc {
  hero: {
    lines: string[];
    text: string;
    imageId: string | null;
    imageAlt: string;
    primaryLabel: string;
    primaryHref: string;
    secondaryLabel: string;
    secondaryHref: string;
  };
  highlights: { title: string; text: string; icon: string; href: string }[];
  services: { title: string; text: string };
  projects: { title: string; text: string; notice: string };
  contact: { title: string; text: string; imageId: string | null; imageAlt: string };
  seo: { title: string; description: string };
}

export interface AboutDoc {
  about: { title: string; lead: string; mainImageId: string | null; mainAlt: string; secondaryImageId: string | null; secondaryAlt: string };
  approach: { title: string; text: string; stages: { title: string; text: string }[] };
  why: { title: string; text: string; principles: { title: string; text: string }[] };
}

export interface CompanyDoc {
  name: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  telegram: string;
  vk: string;
  /** «Обсудить проект» window: number for WhatsApp and Telegram, the prefilled message,
   *  and optional direct links (see src/data/messengers.ts). */
  messengerPhone: string;
  messengerText: string;
  telegramChat: string;
  maxChat: string;
}

export interface Docs {
  homepage: HomepageDoc;
  about: AboutDoc;
  company: CompanyDoc;
}

export type DocKey = keyof Docs;
export const DOC_KEYS: DocKey[] = ['homepage', 'about', 'company'];

export const DOC_TITLES: Record<DocKey, string> = {
  homepage: 'Главная страница',
  about: 'Подход и преимущества',
  company: 'Данные компании',
};

/* ---------- Validation ---------- */

function list<T>(input: unknown, key: string, min: number, max: number, f: Fields, read: (item: Fields, index: number) => T): T[] {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  if (items.length < min || items.length > max) f.fail(key, `Нужно от ${min} до ${max} элементов`);
  return items.slice(0, max).map((item, index) => {
    const fields = new Fields(item);
    const value = read(fields, index);
    for (const [name, message] of Object.entries(fields.errors)) f.fail(`${key}.${index}.${name}`, message);
    return value;
  });
}

function section(input: unknown, key: string): Fields {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
  return new Fields(raw);
}

function merge(f: Fields, prefix: string, inner: Fields): void {
  for (const [name, message] of Object.entries(inner.errors)) f.fail(`${prefix}.${name}`, message);
}

function imageRef(fields: Fields, key: string): string | null {
  const value = fields.raw(key);
  if (value === null || value === undefined || value === '') return null;
  const row = typeof value === 'string' ? getImage(value) : undefined;
  if (!row || row.kind !== 'media') {
    fields.fail(key, 'Изображение не найдено в медиатеке');
    return null;
  }
  return row.id;
}

function lines(value: unknown): string[] {
  const text = Array.isArray(value) ? value.join('\n') : String(value ?? '');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseHomepage(input: unknown): HomepageDoc {
  const f = new Fields(input);

  const h = section(input, 'hero');
  const heroLines = lines(h.raw('lines'));
  if (!heroLines.length) h.fail('lines', 'Заполните заголовок');
  if (heroLines.length > 4) h.fail('lines', 'Не больше 4 строк');
  if (heroLines.some((line) => line.length > 40)) h.fail('lines', 'Каждая строка — не длиннее 40 символов');
  const hero = {
    lines: heroLines.slice(0, 4),
    text: h.text('text', { required: true, max: 200 }),
    imageId: imageRef(h, 'imageId'),
    imageAlt: h.text('imageAlt', { max: 200 }),
    primaryLabel: h.text('primaryLabel', { required: true, max: 40 }),
    primaryHref: h.href('primaryHref', { required: true }),
    secondaryLabel: h.text('secondaryLabel', { max: 40 }),
    secondaryHref: h.href('secondaryHref'),
  };
  if (hero.imageId && !hero.imageAlt) h.fail('imageAlt', 'Опишите изображение для незрячих посетителей');
  if (hero.secondaryLabel && !hero.secondaryHref) h.fail('secondaryHref', 'Укажите ссылку для второй кнопки');
  merge(f, 'hero', h);

  const highlights = list(input, 'highlights', 3, 3, f, (item) => ({
    title: item.text('title', { required: true, max: 60 }),
    text: item.text('text', { required: true, max: 120 }),
    icon: item.oneOf('icon', HIGHLIGHT_ICONS, 'DraftingCompass'),
    href: item.href('href', { required: true }),
  }));

  const s = section(input, 'services');
  const services = { title: s.text('title', { required: true, max: 80 }), text: s.text('text', { max: 200 }) };
  merge(f, 'services', s);

  const p = section(input, 'projects');
  const projects = {
    title: p.text('title', { required: true, max: 80 }),
    text: p.text('text', { max: 200 }),
    notice: p.text('notice', { max: 200 }),
  };
  merge(f, 'projects', p);

  const c = section(input, 'contact');
  const contact = {
    title: c.text('title', { required: true, max: 120 }),
    text: c.text('text', { max: 200 }),
    imageId: imageRef(c, 'imageId'),
    imageAlt: c.text('imageAlt', { max: 200 }),
  };
  if (contact.imageId && !contact.imageAlt) c.fail('imageAlt', 'Опишите изображение для незрячих посетителей');
  merge(f, 'contact', c);

  const m = section(input, 'seo');
  const seo = { title: m.text('title', { required: true, max: 120 }), description: m.text('description', { required: true, max: 300 }) };
  merge(f, 'seo', m);

  f.finish();
  return { hero, highlights, services, projects, contact, seo };
}

export function parseAbout(input: unknown): AboutDoc {
  const f = new Fields(input);

  const a = section(input, 'about');
  const about = {
    title: a.text('title', { required: true, max: 120 }),
    lead: a.text('lead', { required: true, max: 400 }),
    mainImageId: imageRef(a, 'mainImageId'),
    mainAlt: a.text('mainAlt', { max: 200 }),
    secondaryImageId: imageRef(a, 'secondaryImageId'),
    secondaryAlt: a.text('secondaryAlt', { max: 200 }),
  };
  if (about.mainImageId && !about.mainAlt) a.fail('mainAlt', 'Опишите изображение');
  if (about.secondaryImageId && !about.secondaryAlt) a.fail('secondaryAlt', 'Опишите изображение');
  merge(f, 'about', a);

  const ap = section(input, 'approach');
  const approachHead = { title: ap.text('title', { required: true, max: 80 }), text: ap.text('text', { max: 200 }) };
  merge(f, 'approach', ap);
  const stages = list((input as Record<string, unknown>)?.approach, 'stages', 3, 6, f, (item) => ({
    title: item.text('title', { required: true, max: 40 }),
    text: item.text('text', { required: true, max: 120 }),
  }));

  const w = section(input, 'why');
  const whyHead = { title: w.text('title', { required: true, max: 80 }), text: w.text('text', { max: 200 }) };
  merge(f, 'why', w);
  const principles = list((input as Record<string, unknown>)?.why, 'principles', 2, 6, f, (item) => ({
    title: item.text('title', { required: true, max: 60 }),
    text: item.text('text', { required: true, max: 160 }),
  }));

  // list() reports errors as stages.N.field; prefix them with their section.
  for (const key of Object.keys(f.errors)) {
    if (key.startsWith('stages')) f.errors[`approach.${key}`] = f.errors[key]!;
    if (key.startsWith('principles')) f.errors[`why.${key}`] = f.errors[key]!;
    if (key.startsWith('stages') || key.startsWith('principles')) delete f.errors[key];
  }

  f.finish();
  return { about, approach: { ...approachHead, stages }, why: { ...whyHead, principles } };
}

export function parseCompany(input: unknown): CompanyDoc {
  const f = new Fields(input);
  const doc: CompanyDoc = {
    name: f.text('name', { required: true, max: 80 }),
    description: f.text('description', { required: true, max: 200 }),
    phone: f.text('phone', { max: 40 }),
    email: f.text('email', { max: 120 }),
    address: f.text('address', { max: 200 }),
    telegram: f.text('telegram', { max: 200 }),
    vk: f.text('vk', { max: 200 }),
    messengerPhone: f.text('messengerPhone', { max: 40 }),
    messengerText: f.text('messengerText', { required: true, max: 500 }),
    telegramChat: f.text('telegramChat', { max: 200 }),
    maxChat: f.text('maxChat', { max: 300 }),
  };
  const digits = normalizePhone(doc.messengerPhone);
  if (doc.messengerPhone && (digits.length < 10 || digits.length > 15)) {
    f.fail('messengerPhone', 'Номер в международном формате, например +7 985 415-23-58');
  }
  if (doc.telegramChat && !/^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(doc.telegramChat)) {
    f.fail('telegramChat', 'Ссылка вида https://t.me/username');
  }
  if (doc.maxChat && !/^https:\/\/max\.ru\/\S+$/.test(doc.maxChat)) f.fail('maxChat', 'Ссылка из MAX вида https://max.ru/u/…');
  if (doc.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doc.email)) f.fail('email', 'Введите адрес в формате name@company.ru');
  if (doc.phone && doc.phone.replace(/\D/g, '').length < 7) f.fail('phone', 'Укажите номер полностью');
  for (const key of ['telegram', 'vk'] as const) {
    if (doc[key] && !/^https:\/\/[^\s]+$/.test(doc[key])) f.fail(key, 'Ссылка вида https://…');
  }
  f.finish();
  return doc;
}

const parsers: { [K in DocKey]: (input: unknown) => Docs[K] } = {
  homepage: parseHomepage,
  about: parseAbout,
  company: parseCompany,
};

/* ---------- Defaults: the content the site launched with ---------- */

export function defaultDoc<K extends DocKey>(key: K, images: Partial<Record<string, string>> = {}): Docs[K] {
  const docs: Docs = {
    homepage: {
      hero: {
        lines: ru.hero.title,
        text: ru.hero.text,
        imageId: images.hero ?? null,
        imageAlt: ru.hero.imageAlt,
        primaryLabel: ru.hero.primary.label,
        primaryHref: ru.hero.primary.href,
        secondaryLabel: ru.hero.secondary.label,
        secondaryHref: ru.hero.secondary.href,
      },
      highlights: ru.highlights.map(({ title, text, icon, href }) => ({ title, text, icon, href })),
      services: { title: ru.servicesSection.title, text: ru.servicesSection.text },
      projects: { title: ru.projectsSection.title, text: ru.projectsSection.text, notice: ru.projectsSection.notice },
      contact: { title: ru.contact.title, text: ru.contact.text, imageId: images.contact ?? null, imageAlt: ru.contact.imageAlt },
      seo: { title: ru.meta.home.title, description: ru.meta.home.description },
    },
    about: {
      about: {
        title: ru.about.title,
        lead: ru.about.lead,
        mainImageId: images.aboutMain ?? null,
        mainAlt: ru.about.images.main.alt,
        secondaryImageId: images.aboutSecondary ?? null,
        secondaryAlt: ru.about.images.secondary.alt,
      },
      approach: { title: ru.approach.title, text: ru.approach.text, stages: ru.approach.stages.map(({ title, text }) => ({ title, text })) },
      why: { title: ru.why.title, text: ru.why.text, principles: ru.why.principles.map(({ title, text }) => ({ title, text })) },
    },
    company: {
      name: ru.company.name,
      description: ru.footer.description,
      // Not confirmed by the company yet: shown on the site as marked placeholders.
      phone: '',
      email: '',
      address: '',
      telegram: '',
      vk: '',
      ...MESSENGER_DEFAULTS,
    },
  };
  return docs[key];
}

/* ---------- Storage ---------- */

interface DocRow {
  key: DocKey;
  draft: string;
  published: string | null;
  draft_version: number;
  draft_updated_at: string;
  published_at: string | null;
}

function row(key: DocKey): DocRow | undefined {
  return one<DocRow>('SELECT * FROM content_docs WHERE key = ?', key);
}

/** Creates a document with the given content as both draft and published copy. */
export function initDoc<K extends DocKey>(key: K, doc: Docs[K]): void {
  const json = JSON.stringify(doc);
  const time = now();
  run(
    'INSERT OR IGNORE INTO content_docs (key, draft, published, draft_version, draft_updated_at, published_at) VALUES (?, ?, ?, 1, ?, ?)',
    key,
    json,
    json,
    time,
    time,
  );
}

/**
 * Documents saved before a field was added lack that field; it takes its default value.
 * (Adding a field to a document therefore needs no database migration.)
 */
function withDefaults<K extends DocKey>(key: K, stored: Docs[K]): Docs[K] {
  return { ...defaultDoc(key), ...stored };
}

export function getPublished<K extends DocKey>(key: K): Docs[K] {
  const r = row(key);
  return r?.published ? withDefaults(key, JSON.parse(r.published) as Docs[K]) : defaultDoc(key);
}

export function getDraft<K extends DocKey>(key: K): { doc: Docs[K]; version: number; updatedAt: string | null; publishedAt: string | null; pending: boolean } {
  const r = row(key);
  if (!r) return { doc: defaultDoc(key), version: 0, updatedAt: null, publishedAt: null, pending: false };
  const pending = r.draft !== r.published || (key === 'homepage' && featuredDiffers());
  return { doc: withDefaults(key, JSON.parse(r.draft) as Docs[K]), version: r.draft_version, updatedAt: r.draft_updated_at, publishedAt: r.published_at, pending };
}

/** Saves the draft. For the homepage, `featured` is the draft portfolio selection. */
export function saveDraft<K extends DocKey>(key: K, input: unknown, expectedVersion: unknown, userId: number | null, featured?: unknown): Docs[K] {
  const doc = parsers[key](input);
  const ids = key === 'homepage' ? parseFeatured(featured) : null;
  return tx(() => {
    const r = row(key);
    if (r && Number(expectedVersion) !== r.draft_version) throw new ConflictError();
    const json = JSON.stringify(doc);
    if (r) {
      run('UPDATE content_docs SET draft = ?, draft_version = draft_version + 1, draft_updated_at = ? WHERE key = ?', json, now(), key);
    } else {
      run('INSERT INTO content_docs (key, draft, published, draft_version, draft_updated_at) VALUES (?, ?, NULL, 1, ?)', key, json, now());
    }
    if (ids) writeFeatured('draft', ids);
    logActivity(userId, `${key}.draft`, `Сохранён черновик: ${DOC_TITLES[key]}`);
    return doc;
  });
}

/** Makes the draft public. Re-validates it, since referenced images or projects may have changed. */
export function publishDoc(key: DocKey, userId: number | null): void {
  tx(() => {
    const r = row(key);
    if (!r) throw new NotFoundError('Черновик не найден');
    const doc = parsers[key](JSON.parse(r.draft));
    if (key === 'homepage') {
      const ids = readFeatured('draft');
      const invalid = all<{ title: string }>(
        `SELECT title FROM projects WHERE status != 'published' AND id IN (${ids.map(() => '?').join(',') || 'NULL'})`,
        ...ids,
      );
      if (invalid.length) {
        throw new UserError(`В подборке есть неопубликованные проекты: ${invalid.map((p) => `«${p.title}»`).join(', ')}. Опубликуйте их или уберите из подборки.`, 422);
      }
      writeFeatured('published', ids);
    }
    const json = JSON.stringify(doc);
    const time = now();
    run('UPDATE content_docs SET draft = ?, published = ?, published_at = ? WHERE key = ?', json, json, time, key);
    const snapshot = key === 'homepage' ? JSON.stringify({ doc, featured: readFeatured('published') }) : JSON.stringify({ doc });
    run('INSERT INTO content_history (key, data, published_at, user_id) VALUES (?, ?, ?, ?)', key, snapshot, time, userId);
    run(
      `DELETE FROM content_history WHERE key = ? AND id NOT IN (SELECT id FROM content_history WHERE key = ? ORDER BY id DESC LIMIT 30)`,
      key,
      key,
    );
    logActivity(userId, `${key}.publish`, `Опубликовано: ${DOC_TITLES[key]}`);
  });
}

/** Throws the draft away and starts again from the published version. */
export function discardDraft(key: DocKey, userId: number | null): void {
  tx(() => {
    const r = row(key);
    if (!r?.published) throw new UserError('Опубликованной версии ещё нет', 409);
    run('UPDATE content_docs SET draft = published, draft_version = draft_version + 1, draft_updated_at = ? WHERE key = ?', now(), key);
    if (key === 'homepage') writeFeatured('draft', readFeatured('published'));
    logActivity(userId, `${key}.discard`, `Черновик отменён: ${DOC_TITLES[key]}`);
  });
}

export function listHistory(key: DocKey): { id: number; published_at: string; user: string | null }[] {
  return all(
    `SELECT h.id, h.published_at, u.email AS user FROM content_history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.key = ? ORDER BY h.id DESC`,
    key,
  );
}

/** Loads a published version into the draft. It goes live only when published again. */
export function restoreHistory(key: DocKey, historyId: number, userId: number | null): void {
  const entry = one<{ data: string }>('SELECT data FROM content_history WHERE id = ? AND key = ?', historyId, key);
  if (!entry) throw new NotFoundError('Версия не найдена');
  const data = JSON.parse(entry.data) as { doc: unknown; featured?: number[] };
  tx(() => {
    // Images deleted since then are dropped rather than failing the restore.
    const doc = stripMissingImages(data.doc);
    const json = JSON.stringify(parsers[key](doc));
    run('UPDATE content_docs SET draft = ?, draft_version = draft_version + 1, draft_updated_at = ? WHERE key = ?', json, now(), key);
    if (key === 'homepage') {
      const existing = new Set(all<{ id: number }>('SELECT id FROM projects').map((p) => p.id));
      writeFeatured('draft', (data.featured ?? []).filter((id) => existing.has(id)));
    }
    logActivity(userId, `${key}.restore`, `Версия загружена в черновик: ${DOC_TITLES[key]}`);
  });
}

function stripMissingImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMissingImages);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, /ImageId$|^imageId$/.test(k) && typeof v === 'string' && !getImage(v) ? null : stripMissingImages(v)]),
    );
  }
  return value;
}

/* ---------- Homepage portfolio selection ---------- */

function parseFeatured(input: unknown): number[] {
  const values = Array.isArray(input) ? input : [];
  const ids = values.map((v) => Number(v));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new ValidationError({ featured: 'Неверный список проектов' });
  if (new Set(ids).size !== ids.length) throw new ValidationError({ featured: 'Проект выбран дважды' });
  if (ids.length > 24) throw new ValidationError({ featured: 'Не больше 24 проектов на главной' });
  if (ids.length) {
    const found = all<{ id: number }>(`SELECT id FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    if (found.length !== ids.length) throw new ValidationError({ featured: 'Некоторые проекты удалены. Обновите страницу.' });
  }
  return ids;
}

function writeFeatured(stage: 'draft' | 'published', ids: number[]): void {
  run('DELETE FROM featured_projects WHERE stage = ?', stage);
  ids.forEach((id, index) => run('INSERT INTO featured_projects (stage, project_id, position) VALUES (?, ?, ?)', stage, id, index));
}

export function readFeatured(stage: 'draft' | 'published'): number[] {
  return all<{ project_id: number }>('SELECT project_id FROM featured_projects WHERE stage = ? ORDER BY position', stage).map((r) => r.project_id);
}

function featuredDiffers(): boolean {
  return readFeatured('draft').join(',') !== readFeatured('published').join(',');
}
