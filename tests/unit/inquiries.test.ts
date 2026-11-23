import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fieldError, useTempData } from '../helpers.ts';

const dir = useTempData();
const inquiries = await import('../../src/server/inquiries.ts');
const { ValidationError } = await import('../../src/server/errors.ts');

const valid = {
  name: 'Анна',
  company: 'ООО Ромашка',
  email: 'anna@example.ru',
  phone: '+7 900 123-45-67',
  event: 'Иннопром 2027',
  area: '36',
  message: 'Нужен островной стенд с переговорной на 36 м².',
  consent: 'yes', // as sent by the public form's checkbox
};

test('server-side validation matches the public form', () => {
  assert.throws(
    () => inquiries.createInquiry({ fields: { ...valid, email: 'nope', message: 'коротко', area: 'много', consent: '' } }),
    (e: unknown) => e instanceof ValidationError && ['email', 'message', 'area', 'consent'].every((k) => k in e.fields),
  );
  assert.throws(() => inquiries.createInquiry({ fields: { ...valid, phone: '12' } }), (e: unknown) => e instanceof ValidationError && 'phone' in e.fields);
  assert.throws(() => inquiries.parseInquiry({ ...valid, phone: '@anna_stand' }), fieldError('phone', /номер телефона/));
  assert.ok(inquiries.createInquiry({ fields: { ...valid, phone: '8 (900) 123-45-67' } }).id);
});

test('contact: name plus email or phone — either is enough, at least one is required', () => {
  const { email: _email, phone: _phone, ...noContact } = valid;
  assert.equal(inquiries.parseInquiry({ ...noContact, email: 'anna@example.ru' }).phone, '', 'email only');
  assert.equal(inquiries.parseInquiry({ ...noContact, phone: '+7 900 123-45-67' }).email, '', 'phone only');
  assert.throws(() => inquiries.parseInquiry(noContact), fieldError('contact', /почту или телефон/));
  assert.throws(() => inquiries.parseInquiry({ ...noContact, email: '  ', phone: '' }), fieldError('contact', /почту или телефон/));
  // What is filled in must be valid, even when the other one is fine.
  assert.throws(() => inquiries.parseInquiry({ ...valid, email: 'anna@' }), fieldError('email', /name@company/));
  assert.throws(() => inquiries.parseInquiry({ ...valid, phone: '123' }), fieldError('phone', /номер телефона/));
  assert.throws(() => inquiries.parseInquiry({ ...valid, name: '' }), fieldError('name', /Заполните/));
  assert.throws(() => inquiries.parseInquiry({ ...valid, name: '1' }), fieldError('name', /две буквы/));
});

test('stores an inquiry with status new; status and notes can be updated', () => {
  const row = inquiries.createInquiry({ fields: valid });
  assert.equal(row.status, 'new');
  const updated = inquiries.updateInquiry(row.id, { status: 'in_progress', notes: 'Перезвонить в среду' });
  assert.equal(updated.status, 'in_progress');
  assert.throws(() => inquiries.updateInquiry(row.id, { status: 'hacked', notes: '' }), ValidationError);
});

test('attachments: extension and content must match, stored outside the media folder', () => {
  const fake = { name: 'brief.pdf', buffer: Buffer.from('MZ this is an exe') };
  assert.throws(() => inquiries.createInquiry({ fields: valid, file: fake }), fieldError('brief', /не совпадает/));
  assert.throws(() => inquiries.createInquiry({ fields: valid, file: { name: 'run.exe', buffer: Buffer.from('MZ') } }), fieldError('brief', /не поддерживается/));
  const big = { name: 'big.pdf', buffer: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]) };
  assert.throws(() => inquiries.createInquiry({ fields: valid, file: big }), fieldError('brief', /10 МБ/));

  const row = inquiries.createInquiry({ fields: valid, file: { name: 'ТЗ стенд.pdf', buffer: Buffer.from('%PDF-1.7 test') } });
  assert.match(row.attachment_file!, /^[a-f0-9]{32}\.pdf$/);
  assert.equal(row.attachment_name, 'ТЗ стенд.pdf');
  const file = inquiries.attachmentPath(row)!;
  assert.ok(file.startsWith(path.join(dir, 'attachments')));
  inquiries.deleteInquiry(row.id);
  assert.equal(fs.existsSync(file), false);
});

test('spam and archived are hidden from the default list', () => {
  const spam = inquiries.createInquiry({ fields: valid });
  inquiries.updateInquiry(spam.id, { status: 'spam', notes: '' });
  assert.ok(!inquiries.listInquiries().some((i) => i.id === spam.id));
  assert.ok(inquiries.listInquiries({ status: 'spam' }).some((i) => i.id === spam.id));
});

test('e-mail: without SMTP settings nothing is reported as sent', async () => {
  const mail = await import('../../src/server/mail.ts');
  const saved = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, outbox: process.env.MAIL_OUTBOX_DIR };
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.MAIL_OUTBOX_DIR;
  try {
    assert.equal(mail.mailTransport(), null);
    const data = inquiries.parseInquiry(valid);
    await assert.rejects(mail.sendInquiryMail(data, null, 'https://example.ru'), mail.MailNotConfiguredError);
  } finally {
    if (saved.user) process.env.SMTP_USER = saved.user;
    if (saved.pass) process.env.SMTP_PASS = saved.pass;
    if (saved.outbox) process.env.MAIL_OUTBOX_DIR = saved.outbox;
  }
});

test('e-mail: Yandex defaults, recipient businesstend@yandex.ru, sender is the mailbox itself', async () => {
  const mail = await import('../../src/server/mail.ts');
  const saved = { ...process.env };
  process.env.SMTP_USER = 'site@example.ru';
  process.env.SMTP_PASS = 'secret';
  delete process.env.MAIL_OUTBOX_DIR;
  delete process.env.INQUIRY_TO;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  try {
    const transport = mail.mailTransport();
    assert.ok(transport && transport.kind === 'smtp');
    assert.equal(transport.host, 'smtp.yandex.ru');
    assert.equal(transport.port, 465);
    assert.equal(transport.secure, true);
    assert.equal(transport.to, 'businesstend@yandex.ru');
    assert.equal(transport.from, 'site@example.ru');
  } finally {
    process.env = saved;
  }
});

test('e-mail: the message carries the inquiry, the reply address and the brief', async () => {
  const mail = await import('../../src/server/mail.ts');
  const outbox = path.join(dir, 'outbox-unit');
  process.env.MAIL_OUTBOX_DIR = outbox;
  try {
    const brief = inquiries.prepareAttachment({ name: '../ТЗ стенд.pdf', buffer: Buffer.from('%PDF-1.7 test') });
    assert.equal(brief.name, 'ТЗ стенд.pdf', 'no path in the file name');
    await mail.sendInquiryMail(inquiries.parseInquiry(valid), brief, 'https://example.ru');
    const [file] = fs.readdirSync(outbox);
    const eml = fs.readFileSync(path.join(outbox, file!), 'utf8');
    assert.match(eml, /^To: businesstend@yandex\.ru$/m);
    assert.match(eml, /^Reply-To:[^\n]*(?:\n [^\n]*)*anna@example\.ru/m, 'header may be folded');
    assert.match(eml, /^Subject: =\?UTF-8\?/m);
    // The text part is encoded (Cyrillic): decode it to check the content.
    const part = eml.match(/Content-Type: text\/plain[^\n]*\nContent-Transfer-Encoding: (\S+)\n\n([\s\S]*?)\n--/)!;
    const text =
      part[1] === 'base64'
        ? Buffer.from(part[2]!, 'base64').toString('utf8')
        : Buffer.from(part[2]!.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
    assert.match(text, /Имя: Анна/);
    assert.match(text, /Нужен островной стенд/);
    assert.match(text, /https:\/\/example\.ru\/consent\//);
    assert.match(text, /Телефон: \+7 900 123-45-67/);
    assert.match(text, /Почта: anna@example\.ru/);
    assert.match(eml, /Content-Disposition: attachment/);
  } finally {
    delete process.env.MAIL_OUTBOX_DIR;
  }
});

test('e-mail: without an email the phone is the way back, and there is no Reply-To', async () => {
  const mail = await import('../../src/server/mail.ts');
  const outbox = path.join(dir, 'outbox-phone-only');
  process.env.MAIL_OUTBOX_DIR = outbox;
  try {
    const { email: _email, ...phoneOnly } = valid;
    await mail.sendInquiryMail(inquiries.parseInquiry(phoneOnly), null, 'https://example.ru');
    const eml = fs.readFileSync(path.join(outbox, fs.readdirSync(outbox)[0]!), 'utf8');
    assert.doesNotMatch(eml, /^Reply-To:/m);
    assert.match(eml, /^To: businesstend@yandex\.ru$/m);
  } finally {
    delete process.env.MAIL_OUTBOX_DIR;
  }
});
