/**
 * Messenger contact for the «Обсудить проект» window.
 *
 * These are the starting values. The live values are edited in the admin panel
 * (Настройки → Мессенджеры) and stored with the other company details; nothing else in
 * the code holds the number or the message.
 *
 * How each messenger is linked (checked against the official documentation):
 * - WhatsApp: https://wa.me/<number>?text=… opens the chat with the prepared message filled in.
 *   WhatsApp is the only messenger that receives the message text.
 * - Telegram: https://t.me/+<number> (core.telegram.org/api/links) opens the chat, empty. It finds
 *   the account only if its privacy setting «Кто может найти меня по номеру» allows it; otherwise
 *   set a username link (https://t.me/<username>) in the admin panel.
 * - MAX: there is no documented link that opens a chat by phone number, and its profile links
 *   (https://max.ru/u/…) are generated in the app. Until such a link is entered in the admin
 *   panel, the window shows the number to copy instead of a guessed link.
 * None of these send anything: the visitor writes or reviews the message and sends it.
 */

export const MESSENGER_DEFAULTS = {
  messengerPhone: '+7 985 415-23-58',
  messengerText:
    'Здравствуйте! Меня интересует разработка и застройка выставочного стенда. Хотелось бы обсудить детали проекта и узнать о возможных вариантах сотрудничества.',
  /** Optional: https://t.me/<username>. Empty — the phone number link is used. */
  telegramChat: '',
  /** Optional: the profile link copied from MAX (https://max.ru/u/…). Empty — copy fallback. */
  maxChat: '',
};

export type MessengerSettings = typeof MESSENGER_DEFAULTS;

/** Digits in international format: '+7 985 415-23-58' → '79854152358' (a leading 8 becomes 7). */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}

export interface MessengerLinks {
  phone: string;
  phoneDigits: string;
  text: string;
  whatsapp: string | null;
  telegram: string | null;
  /** MAX gets no message; null when no profile link is configured. */
  max: string | null;
}

function withText(url: string, text: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(text)}`;
}

export function messengerLinks(settings: MessengerSettings): MessengerLinks {
  const phoneDigits = normalizePhone(settings.messengerPhone);
  const valid = phoneDigits.length >= 10 && phoneDigits.length <= 15;
  return {
    phone: settings.messengerPhone,
    phoneDigits,
    text: settings.messengerText,
    whatsapp: valid ? withText(`https://wa.me/${phoneDigits}`, settings.messengerText) : null,
    // Telegram opens the chat only; the prepared text goes to WhatsApp alone.
    telegram: settings.telegramChat ? settings.telegramChat.replace(/\/$/, '') : valid ? `https://t.me/+${phoneDigits}` : null,
    max: settings.maxChat || null,
  };
}
