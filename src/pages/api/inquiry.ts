import type { APIRoute } from 'astro';
import { hit, pruneRateLimits } from '@/server/auth';
import { limits } from '@/server/config';
import { clientIp, handle, json, readForm } from '@/server/http';
import { parseInquiry, prepareAttachment } from '@/server/inquiries';
import { MailNotConfiguredError, sendInquiryMail } from '@/server/mail';

/**
 * Receives the public inquiry form and e-mails it to the company (src/server/mail.ts).
 * Nothing is stored on the site. The visitor gets a success answer only after the mail server
 * has accepted the message; otherwise an honest error with another way to get in touch.
 * Spam protection: a hidden honeypot field and a per-address rate limit;
 * cross-site posts are rejected by Astro's origin check.
 * The addresses kept for the rate limit are deleted within a day (the privacy policy says so).
 */
const NOT_SENT =
  'Не удалось отправить заявку. Попробуйте ещё раз через несколько минут или напишите нам в мессенджер — кнопка «Обсудить проект» вверху страницы.';

export const POST: APIRoute = ({ request, clientAddress, url, site }) =>
  handle(async () => {
    pruneRateLimits();
    if (!hit(`inquiry:${clientIp(request, clientAddress)}`, 5, 10 * 60 * 1000)) {
      return json({ error: 'Слишком много заявок подряд. Попробуйте через несколько минут или напишите нам в мессенджер.' }, 429);
    }

    const form = await readForm(request, limits.attachmentBytes + 1024 * 1024);
    // Bots fill every field; people never see this one. Pretend success and send nothing.
    if (String(form.get('website') ?? '').trim()) return { ok: true };

    const fields: Record<string, unknown> = {};
    for (const key of ['name', 'company', 'email', 'phone', 'event', 'area', 'message', 'consent']) {
      const value = form.get(key);
      if (typeof value === 'string') fields[key] = value;
    }
    const data = parseInquiry(fields);
    const brief = form.get('brief');
    const file =
      brief instanceof File && brief.size > 0 ? prepareAttachment({ name: brief.name, buffer: Buffer.from(await brief.arrayBuffer()) }) : null;

    try {
      // The public address (SITE_URL) for the link in the message, not the address behind a proxy.
      await sendInquiryMail(data, file, (site ?? url).origin);
    } catch (error) {
      // Logged without the inquiry itself: no personal data in the server log.
      const reason = error instanceof MailNotConfiguredError ? 'e-mail is not configured (SMTP_USER/SMTP_PASS)' : String((error as Error).message ?? error);
      console.error(`[inquiry] not sent: ${reason.slice(0, 300)}`);
      return json({ error: NOT_SENT }, 503);
    }
    return { ok: true };
  });
