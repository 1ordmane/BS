import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { limits, paths } from './config.ts';
import { all, now, one, run, tx } from './db.ts';
import { NotFoundError, ValidationError } from './errors.ts';
import { Fields, isEmail } from './validate.ts';

export const STATUSES = ['new', 'in_progress', 'done', 'spam', 'archived'] as const;
export type InquiryStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Обработана',
  spam: 'Спам',
  archived: 'В архиве',
};

export interface InquiryRow {
  id: number;
  created_at: string;
  updated_at: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  event: string;
  area: string;
  message: string;
  page: string;
  attachment_file: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  status: InquiryStatus;
  notes: string;
}

// Same rules as the browser-side check on the public form (InquiryForm.astro).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// A phone number: digits with optional +, spaces, brackets and dashes; 10 to 15 digits in all.
const PHONE_CHARS = /^\+?[\d\s()\-]{10,25}$/;
export const isPhone = (text: string) => PHONE_CHARS.test(text) && /^\d{10,15}$/.test(text.replace(/\D/g, ''));
// A name: at least two letters.
const isName = (text: string) => (text.match(/\p{L}/gu) ?? []).length >= 2;
const AREA = /^\d{1,5}(?:[.,]\d{1,2})?$/;

const ATTACHMENT_TYPES: Record<string, (head: Buffer) => boolean> = {
  pdf: (h) => h.subarray(0, 5).toString('latin1') === '%PDF-',
  jpg: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  jpeg: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  png: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  // Office Open XML files and ZIP archives share the ZIP signature
  docx: isZip,
  pptx: isZip,
  xlsx: isZip,
  zip: isZip,
  // Legacy Office files use the OLE2 compound document signature
  doc: isOle,
  ppt: isOle,
  xls: isOle,
};

function isZip(h: Buffer): boolean {
  return h[0] === 0x50 && h[1] === 0x4b && (h[2] === 0x03 || h[2] === 0x05 || h[2] === 0x07);
}

function isOle(h: Buffer): boolean {
  return h.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

export interface InquiryInput {
  fields: Record<string, unknown>;
  file?: { name: string; buffer: Buffer } | null;
}

/** What the public form sends, after the server-side check. */
export type InquiryData = Pick<InquiryRow, 'name' | 'company' | 'email' | 'phone' | 'event' | 'area' | 'message'>;

export function parseInquiry(fields: Record<string, unknown>): InquiryData {
  const f = new Fields(fields);
  const data = {
    name: f.text('name', { required: true, max: 120 }),
    company: f.text('company', { max: 160 }),
    email: f.text('email', { max: 200 }),
    phone: f.text('phone', { max: 40 }),
    event: f.text('event', { max: 200 }),
    area: f.text('area', { max: 20 }),
    // Optional: the visitor may describe the project or leave it for the conversation.
    message: f.text('message', { max: 5000, multiline: true }),
  };
  if (data.name && !isName(data.name)) f.fail('name', 'Укажите имя — хотя бы две буквы');
  // A way to reach the visitor: email, phone or both. Whatever is filled in must be valid.
  if (data.email && (!EMAIL.test(data.email) || !isEmail(data.email))) f.fail('email', 'Введите адрес в формате name@company.ru');
  if (data.phone && !isPhone(data.phone)) f.fail('phone', 'Введите номер телефона, например +7 900 123-45-67');
  if (!data.email && !data.phone) f.fail('contact', 'Укажите почту или телефон, чтобы мы могли с вами связаться');
  if (data.area && !AREA.test(data.area)) f.fail('area', 'Укажите площадь числом, например 36');
  if (!f.bool('consent')) f.fail('consent', 'Подтвердите согласие на обработку данных');
  f.finish();
  return data;
}

/** Checks an attached brief (type by content, size) and returns it with a safe file name. */
export function prepareAttachment(file: { name: string; buffer: Buffer }): { name: string; buffer: Buffer } {
  const ext = checkAttachment(file);
  return { name: safeName(file.name, ext), buffer: file.buffer };
}

function safeName(name: string, ext: string): string {
  return path.basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150) || `attachment.${ext}`;
}

function checkAttachment(file: { name: string; buffer: Buffer }): string {
  const ext = path.extname(file.name).slice(1).toLowerCase();
  const matches = ATTACHMENT_TYPES[ext];
  if (!matches) throw new ValidationError({ brief: 'Этот формат не поддерживается. Прикрепите PDF, DOC, PPT, XLS, JPG, PNG или ZIP' });
  if (file.buffer.length > limits.attachmentBytes) {
    throw new ValidationError({ brief: 'Файл больше 10 МБ. Прикрепите файл меньшего размера или отправьте ссылку в описании' });
  }
  if (!matches(file.buffer.subarray(0, 16))) {
    throw new ValidationError({ brief: 'Содержимое файла не совпадает с его расширением' });
  }
  return ext;
}

/**
 * Stores an inquiry for the admin panel (Заявки). The public form no longer uses it — inquiries
 * are e-mailed (src/server/mail.ts) — it serves inquiries saved earlier and the admin tests.
 */
export function createInquiry(input: InquiryInput): InquiryRow {
  const data = parseInquiry(input.fields);
  let stored: { file: string; name: string; size: number } | null = null;

  if (input.file && input.file.buffer.length > 0) {
    const ext = checkAttachment(input.file);
    const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const dir = paths.attachments();
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `.tmp-${file}`);
    fs.writeFileSync(temp, input.file.buffer, { mode: 0o600 });
    fs.renameSync(temp, path.join(dir, file));
    const name = safeName(input.file.name, ext);
    stored = { file, name, size: input.file.buffer.length };
  }

  try {
    const time = now();
    const { lastInsertRowid } = run(
      `INSERT INTO inquiries (created_at, updated_at, name, company, email, phone, event, area, message, page,
        attachment_file, attachment_name, attachment_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      time,
      time,
      data.name,
      data.company,
      data.email,
      data.phone,
      data.event,
      data.area,
      data.message,
      '',
      stored?.file ?? null,
      stored?.name ?? null,
      stored?.size ?? null,
    );
    return getInquiry(lastInsertRowid);
  } catch (error) {
    if (stored) fs.rmSync(path.join(paths.attachments(), stored.file), { force: true });
    throw error;
  }
}

export function getInquiry(id: number): InquiryRow {
  const row = one<InquiryRow>('SELECT * FROM inquiries WHERE id = ?', id);
  if (!row) throw new NotFoundError('Заявка не найдена');
  return row;
}

export function listInquiries(query: { status?: string; q?: string } = {}): InquiryRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if ((STATUSES as readonly string[]).includes(query.status ?? '')) {
    where.push('status = ?');
    params.push(query.status);
  } else if (query.status !== 'all') {
    // By default hide spam and archived inquiries.
    where.push("status NOT IN ('spam', 'archived')");
  }
  const q = (query.q ?? '').trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(`(${['name', 'company', 'email', 'phone', 'event'].map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    params.push(like, like, like, like, like);
  }
  return all(`SELECT * FROM inquiries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT 500`, ...params);
}

export function countByStatus(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM inquiries GROUP BY status')) counts[row.status] = Number(row.n);
  return counts;
}

export function updateInquiry(id: number, input: unknown): InquiryRow {
  const f = new Fields(input);
  const status = f.oneOf('status', STATUSES);
  const notes = f.text('notes', { max: 5000, multiline: true });
  f.finish();
  getInquiry(id);
  run('UPDATE inquiries SET status = ?, notes = ?, updated_at = ? WHERE id = ?', status, notes, now(), id);
  return getInquiry(id);
}

export function deleteInquiry(id: number): void {
  const row = getInquiry(id);
  tx(() => run('DELETE FROM inquiries WHERE id = ?', id));
  if (row.attachment_file) fs.rmSync(path.join(paths.attachments(), row.attachment_file), { force: true });
}

export function attachmentPath(row: InquiryRow): string | null {
  if (!row.attachment_file || !/^[a-f0-9]{32}\.[a-z]{3,4}$/.test(row.attachment_file)) return null;
  const file = path.join(paths.attachments(), row.attachment_file);
  return fs.existsSync(file) ? file : null;
}
