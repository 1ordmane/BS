import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/** Points the server code at a fresh, empty data directory. Call before using the database. */
export function useTempData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-test-'));
  process.env.DATA_DIR = dir;
  return dir;
}

/** A real image file of the given size and format. */
export function makeImage(width = 800, height = 600, format: 'png' | 'jpeg' | 'webp' = 'jpeg', color = '#2a7a5a'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    [format]()
    .toBuffer();
}

export function sampleProject(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Тестовый стенд',
    category: 'island',
    summary: 'Краткое описание тестового стенда.',
    description: '## Задача\n\nПоказать продукт.\n\n## Решение\n\nОстровной стенд.',
    scope: 'Дизайн\nПроизводство',
    ...overrides,
  };
}

/** assert.throws predicate: a ValidationError whose field message matches. */
export function fieldError(field: string, pattern: RegExp) {
  return (error: unknown) => {
    const fields = (error as { fields?: Record<string, string> }).fields;
    return !!fields && pattern.test(fields[field] ?? '');
  };
}
