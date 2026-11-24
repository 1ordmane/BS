import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { InquiryData } from './inquiries.ts';

/**
 * E-mail delivery of the public inquiry form. Every inquiry goes to INQUIRY_RECIPIENT; nothing is
 * kept on the site. Server-side only: the SMTP login and password come from environment variables
 * and never reach the browser.
 *
 * Settings (see .env.example and README «Заявки по почте»):
 *   SMTP_USER, SMTP_PASS   mailbox the site sends from and its password (for Yandex: an app password)
 *   SMTP_HOST, SMTP_PORT   default smtp.yandex.ru:465 (SSL)
 *   MAIL_FROM              sender address, default SMTP_USER (Yandex accepts only the mailbox itself)
 *   INQUIRY_TO             recipient, default businesstend@yandex.ru
 *   MAIL_OUTBOX_DIR        development and tests only: write the messages as .eml files there
 *                          instead of sending them
 */

export const INQUIRY_RECIPIENT = 'businesstend@yandex.ru';

type Transport =
  | { kind: 'smtp'; host: string; port: number; secure: boolean; user: string; pass: string; from: string; to: string }
  | { kind: 'outbox'; dir: string; from: string; to: string };

/** The configured delivery, or null when the site cannot send e-mail yet. */
export function mailTransport(): Transport | null {
  const to = process.env.INQUIRY_TO?.trim() || INQUIRY_RECIPIENT;
  const outbox = process.env.MAIL_OUTBOX_DIR?.trim();
  if (outbox) return { kind: 'outbox', dir: path.resolve(outbox), from: process.env.MAIL_FROM?.trim() || 'site@localhost', to };

  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT) || 465;
  return {
    kind: 'smtp',
    host: process.env.SMTP_HOST?.trim() || 'smtp.yandex.ru',
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== 'false' : port === 465,
    user,
    pass,
    from: process.env.MAIL_FROM?.trim() || user,
    to,
  };
}

export class MailNotConfiguredError extends Error {}

const LABELS: [keyof InquiryData, string][] = [
  ['name', 'Имя'],
  ['company', 'Компания'],
  ['email', 'Почта'],
  ['phone', 'Телефон'],
  ['event', 'Выставка или событие'],
  ['area', 'Площадь стенда, м²'],
];

function moscowTime(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(date);
}

/** Builds the message: plain text, the visitor's address as Reply-To, the brief attached. */
function compose(data: InquiryData, file: { name: string; buffer: Buffer } | null, siteUrl: string, sentAt: Date) {
  const lines = ['Новая заявка с сайта BUSINESS STAND', ''];
  for (const [key, label] of LABELS) if (data[key]) lines.push(`${label}: ${data[key]}`);
  // The description is optional: say so plainly rather than leave an empty heading.
  lines.push('', ...(data.message ? ['О проекте:', data.message] : ['О проекте: клиент не заполнил это поле']), '');
  if (file) lines.push(`Вложение: ${file.name} (${Math.max(1, Math.round(file.buffer.length / 1024))} КБ)`, '');
  lines.push(
    `Отправлена: ${moscowTime(sentAt)} (МСК)`,
    `Согласие на обработку персональных данных дано при отправке: ${new URL('/consent/', siteUrl).href}`,
    '',
    data.email
      ? 'Чтобы ответить, нажмите «Ответить» — письмо уйдёт на почту, указанную в заявке.'
      : 'Почту клиент не указал — свяжитесь с ним по телефону.',
  );
  const subject = `Заявка с сайта: ${data.name}${data.company ? `, ${data.company}` : ''}`.replace(/[\r\n]+/g, ' ').slice(0, 200);
  return {
    subject,
    text: lines.join('\n'),
    // Reply goes to the visitor when they gave an email; otherwise the phone is the way back.
    ...(data.email ? { replyTo: { name: data.name, address: data.email } } : {}),
    attachments: file ? [{ filename: file.name, content: file.buffer }] : [],
  };
}

/**
 * Sends one inquiry. Resolves only when the mail server has accepted the message for the
 * recipient; throws MailNotConfiguredError without settings, or the SMTP error otherwise.
 */
export async function sendInquiryMail(data: InquiryData, file: { name: string; buffer: Buffer } | null, siteUrl: string): Promise<void> {
  const transport = mailTransport();
  if (!transport) throw new MailNotConfiguredError('SMTP_USER / SMTP_PASS are not set');
  const message = { ...compose(data, file, siteUrl, new Date()), from: { name: 'Сайт BUSINESS STAND', address: transport.from }, to: transport.to };

  if (transport.kind === 'outbox') {
    const info = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail(message);
    fs.mkdirSync(transport.dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.eml`;
    fs.writeFileSync(path.join(transport.dir, name), info.message as Buffer, { mode: 0o600 });
    return;
  }

  const smtp = nodemailer.createTransport({
    host: transport.host,
    port: transport.port,
    secure: transport.secure,
    // Port 587: upgrade to TLS or fail, never send the password or the inquiry in the clear.
    requireTLS: !transport.secure,
    auth: { user: transport.user, pass: transport.pass },
    // The visitor waits for the answer: give up rather than hang.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await smtp.sendMail(message);
    // Entries are strings or { address } objects depending on how the recipient was given.
    const accepted = (info.accepted as (string | { address: string })[]).map((item) => (typeof item === 'string' ? item : item.address).toLowerCase());
    if (!accepted.includes(transport.to.toLowerCase())) throw new Error(`recipient not accepted: ${info.response}`);
  } finally {
    smtp.close();
  }
}
