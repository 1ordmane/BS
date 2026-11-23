import { ValidationError } from './errors.ts';

/**
 * Small validation helpers. Each reader takes untrusted input, normalises it and records
 * a readable error per field; finish() throws them together.
 */
export class Fields {
  readonly errors: Record<string, string> = {};
  private readonly input: Record<string, unknown>;

  constructor(input: unknown) {
    this.input = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  }

  raw(key: string): unknown {
    return this.input[key];
  }

  has(key: string): boolean {
    return key in this.input;
  }

  fail(key: string, message: string): void {
    if (!this.errors[key]) this.errors[key] = message;
  }

  text(key: string, options: { label?: string; max?: number; required?: boolean; multiline?: boolean } = {}): string {
    const value = cleanText(this.input[key], options.multiline ?? false);
    const max = options.max ?? 200;
    if (options.required && !value) this.fail(key, 'Заполните это поле');
    else if (value.length > max) this.fail(key, `Не длиннее ${max} символов`);
    return value.slice(0, max);
  }

  bool(key: string): boolean {
    const value = this.input[key];
    return value === true || value === 1 || ['true', 'on', 'yes', '1'].includes(String(value));
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback?: T): T {
    const value = String(this.input[key] ?? '');
    if ((allowed as readonly string[]).includes(value)) return value as T;
    if (fallback !== undefined) return fallback;
    this.fail(key, 'Выберите значение из списка');
    return allowed[0]!;
  }

  slug(key: string, options: { required?: boolean } = {}): string {
    const value = String(this.input[key] ?? '').trim().toLowerCase();
    if (!value) {
      if (options.required) this.fail(key, 'Заполните это поле');
      return '';
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 80) {
      this.fail(key, 'Только латиница, цифры и дефисы, например island-stand');
    }
    return value;
  }

  /** Link inside the site (/path, /#anchor) or an absolute http(s) URL. */
  href(key: string, options: { required?: boolean } = {}): string {
    const value = cleanText(this.input[key], false);
    if (!value) {
      if (options.required) this.fail(key, 'Заполните это поле');
      return '';
    }
    if (!isSafeHref(value)) this.fail(key, 'Ссылка вида /#contact, /projects/ или https://…');
    return value.slice(0, 300);
  }

  finish(): void {
    if (Object.keys(this.errors).length) throw new ValidationError(this.errors);
  }
}

/** Trims, removes control characters and normalises line breaks. */
export function cleanText(value: unknown, multiline: boolean): string {
  if (value === null || value === undefined) return '';
  let text = String(value).normalize('NFC').replace(/\r\n?/g, '\n');
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (!multiline) text = text.replace(/\s*\n\s*/g, ' ');
  else text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function isSafeHref(value: string): boolean {
  if (/^\/(?!\/)[^\s]*$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !/\s/.test(value);
  } catch {
    return false;
  }
}

const translit: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Readable Latin slug from any title, Russian included. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((char) => translit[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}
