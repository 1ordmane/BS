/**
 * Delivery of the project inquiry form to the site's own server (/api/inquiry), which e-mails
 * it to the company. «success» only when the server answered OK, i.e. the mail server accepted it.
 */

export interface InquiryResult {
  state: 'success' | 'error';
  /** Server message, e.g. when too many inquiries were sent. */
  message?: string;
  /** Field errors from the server-side check. */
  fields?: Record<string, string>;
}

export async function sendInquiry(data: FormData): Promise<InquiryResult> {
  try {
    const response = await fetch('/api/inquiry', {
      method: 'POST',
      body: data,
      headers: { Accept: 'application/json' },
    });
    if (response.ok) return { state: 'success' };
    const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
    return { state: 'error', message: body.error, fields: body.fields };
  } catch {
    return { state: 'error' };
  }
}
