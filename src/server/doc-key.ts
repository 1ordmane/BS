import { DOC_KEYS, type DocKey } from './content.ts';
import { NotFoundError } from './errors.ts';

export function docKey(value: string | undefined): DocKey {
  if (!DOC_KEYS.includes(value as DocKey)) throw new NotFoundError('Раздел не найден');
  return value as DocKey;
}
