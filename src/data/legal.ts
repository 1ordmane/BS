import type { CompanyDoc } from '@/server/content';
import { messengerLinks } from './messengers';

/**
 * Facts about the personal-data operator for the privacy policy (/privacy/) and the consent
 * text (/consent/). Only the company can supply them, so nothing here is guessed: every empty
 * value is simply left out of the published pages. Fill them in before launch — see the list
 * in README.md («Персональные данные»).
 */
export const operator = {
  /** The operator. Submitted personal data is processed by this company only. */
  name: 'ООО «Бизнесстенд»',
  /** Full name as in ЕГРЮЛ, e.g. «Общество с ограниченной ответственностью "…"». */
  fullName: '',
  inn: '',
  ogrn: '',
  /** Legal address (адрес места нахождения). */
  address: '',
  /** Postal address for written requests about personal data, if it differs from the legal one. */
  postalAddress: '',
  /** E-mail for requests about personal data. When empty, the e-mail from Настройки is used. */
  email: '',
  /** Person responsible for organising personal-data processing (ст. 18.1 152-ФЗ): name or position. */
  responsible: '',
  /**
   * Where the server with the database and the attached files is located, e.g.
   * «на серверах ООО "…" в г. Москве (Российская Федерация)». 152-ФЗ requires databases with
   * Russian citizens' data to be in Russia (ст. 18 ч. 5).
   */
  dataLocation: '',
  /** Companies processing the data on the operator's instruction (hosting, e-mail…), if any. */
  processors: [] as { name: string; address: string; purpose: string }[],
  /** Set to false once confirmed that no data leaves Russia; true requires its own section. */
  crossBorderTransfer: null as boolean | null,
  /** Specific retention period, if the company sets one (otherwise the legal rule is stated). */
  retention: '',
  /** Edition date of the policy, e.g. «1 декабря 2026 г.». */
  edition: '',
};

/** Operator details that are filled in, as label/value pairs. */
export function operatorDetails(): { label: string; value: string }[] {
  return [
    { label: 'Полное наименование', value: operator.fullName },
    { label: 'ИНН', value: operator.inn },
    { label: 'ОГРН', value: operator.ogrn },
    { label: 'Адрес', value: operator.address },
  ].filter((item) => item.value);
}

export interface RequestChannel {
  label: string;
  value: string;
  href?: string;
}

/**
 * Ways to send a request or withdraw consent: only channels that actually exist,
 * from this file and from the company settings in the admin panel.
 */
export function requestChannels(company: CompanyDoc): RequestChannel[] {
  const channels: RequestChannel[] = [];
  const email = operator.email || company.email;
  if (email) channels.push({ label: 'Электронная почта', value: email, href: `mailto:${email}` });
  const postal = operator.postalAddress || operator.address || company.address;
  if (postal) channels.push({ label: 'Почтовый адрес', value: postal });
  if (company.phone) channels.push({ label: 'Телефон', value: company.phone, href: `tel:${company.phone.replace(/[^\d+]/g, '')}` });
  const links = messengerLinks(company);
  if (links.phoneDigits.length >= 10 && links.phoneDigits.length <= 15) {
    channels.push({ label: 'WhatsApp, Telegram или MAX', value: links.phone });
  }
  return channels;
}

/** What the inquiry form collects (InquiryForm.astro, src/server/inquiries.ts) and e-mails (src/server/mail.ts). */
export const formData = {
  required: ['имя', 'адрес электронной почты или номер телефона (хотя бы одно из двух)'],
  optional: [
    'описание проекта',
    'название компании',
    'название выставки или события',
    'площадь стенда',
    'файл с брифом или техническим заданием и сведения, которые в нём содержатся',
  ],
  automatic: ['дата и время отправки заявки'],
};

/** Actions with the data (ст. 3 152-ФЗ), as performed by the site and its admin panel. */
export const actions =
  'сбор, запись, систематизация, накопление, хранение, уточнение (обновление, изменение), извлечение, использование, удаление и уничтожение';
