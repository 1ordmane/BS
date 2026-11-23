import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldError, useTempData } from '../helpers.ts';

useTempData();
const { MESSENGER_DEFAULTS, messengerLinks, normalizePhone } = await import('../../src/data/messengers.ts');
const content = await import('../../src/server/content.ts');
const { run } = await import('../../src/server/db.ts');

const message = MESSENGER_DEFAULTS.messengerText;

test('the default contact is +7 985 415-23-58, normalised to 79854152358', () => {
  assert.equal(MESSENGER_DEFAULTS.messengerPhone, '+7 985 415-23-58');
  assert.equal(normalizePhone('+7 985 415-23-58'), '79854152358');
  assert.equal(normalizePhone('8 (985) 415-23-58'), '79854152358');
});

test('only WhatsApp gets the prepared message; Telegram opens the chat without it; MAX needs a profile link', () => {
  const links = messengerLinks(MESSENGER_DEFAULTS);
  assert.equal(links.whatsapp, `https://wa.me/79854152358?text=${encodeURIComponent(message)}`);
  assert.equal(links.telegram, 'https://t.me/+79854152358');
  assert.equal(new URL(links.telegram!).searchParams.has('text'), false, 'no text for Telegram');
  assert.equal(new URL(links.whatsapp!).searchParams.get('text'), message);
  assert.equal(links.max, null, 'no guessed MAX link');
});

test('a Telegram username link and a MAX profile link replace the fallbacks when set', () => {
  const links = messengerLinks({ ...MESSENGER_DEFAULTS, telegramChat: 'https://t.me/business_stand/', maxChat: 'https://max.ru/u/abc123' });
  assert.equal(links.telegram, 'https://t.me/business_stand');
  assert.equal(links.max, 'https://max.ru/u/abc123');
});

test('without a valid number there are no WhatsApp/Telegram links (the window shows them as unavailable)', () => {
  const links = messengerLinks({ ...MESSENGER_DEFAULTS, messengerPhone: '' });
  assert.equal(links.whatsapp, null);
  assert.equal(links.telegram, null);
});

test('settings saved before the messenger fields existed get the defaults', () => {
  const old = { ...content.defaultDoc('company') } as Record<string, unknown>;
  for (const key of Object.keys(MESSENGER_DEFAULTS)) delete old[key];
  run(
    "INSERT INTO content_docs (key, draft, published, draft_version, draft_updated_at) VALUES ('company', ?, ?, 1, 'now')",
    JSON.stringify(old),
    JSON.stringify(old),
  );
  assert.equal(content.getPublished('company').messengerPhone, '+7 985 415-23-58');
  assert.equal(content.getDraft('company').doc.messengerText, message);
});

test('admin settings validate the messenger fields', () => {
  const draft = content.getDraft('company');
  const bad = { ...draft.doc, messengerPhone: '123', telegramChat: 'https://evil.example/x', maxChat: 'http://max.ru/u/1', messengerText: '' };
  assert.throws(() => content.saveDraft('company', bad, draft.version, null), fieldError('messengerPhone', /международном/));
  assert.throws(() => content.saveDraft('company', bad, draft.version, null), fieldError('telegramChat', /t\.me/));
  assert.throws(() => content.saveDraft('company', bad, draft.version, null), fieldError('maxChat', /max\.ru/));
  assert.throws(() => content.saveDraft('company', bad, draft.version, null), fieldError('messengerText', /Заполните/));
});
