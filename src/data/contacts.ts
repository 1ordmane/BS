import type { CompanyDoc } from '@/server/content';
import { ru } from './ru';

export interface Channel {
  label: string;
  value: string;
  placeholder: string;
  href: string;
  /** What the copy button puts on the clipboard: the bare number or address. */
  copy?: { text: string; label: 'phone' | 'email' };
}

const placeholderOf = (label: string) => {
  const channel = [...ru.contact.channels, ...ru.footer.social].find((item) => item.label === label);
  return channel && typeof channel.value === 'object' ? channel.value.placeholder : label;
};

/** Contact details from the admin settings; empty ones keep their marked placeholder. */
export function contactChannels(company: CompanyDoc): Channel[] {
  return [
    {
      label: 'Телефон',
      value: company.phone,
      placeholder: placeholderOf('Телефон'),
      href: company.phone ? `tel:${company.phone.replace(/[^\d+]/g, '')}` : '',
      copy: company.phone ? { text: company.phone, label: 'phone' } : undefined,
    },
    {
      label: 'Почта',
      value: company.email,
      placeholder: placeholderOf('Почта'),
      href: company.email ? `mailto:${company.email}` : '',
      copy: company.email ? { text: company.email, label: 'email' } : undefined,
    },
    { label: 'Адрес', value: company.address, placeholder: placeholderOf('Адрес'), href: '' },
  ];
}

export function socialChannels(company: CompanyDoc): Channel[] {
  return [
    { label: 'Telegram', value: company.telegram ? 'Telegram' : '', placeholder: 'Telegram', href: company.telegram },
    { label: 'VK', value: company.vk ? 'VK' : '', placeholder: 'VK', href: company.vk },
  ];
}
