import { limits } from './config.ts';
import { ConflictError, NotFoundError, UserError, ValidationError } from './errors.ts';

/** JSON helpers for the API endpoints. */

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ValidationError) return json({ error: error.message, fields: error.fields }, 422);
  if (error instanceof ConflictError) return json({ error: error.message }, 409);
  if (error instanceof NotFoundError) return json({ error: error.message }, 404);
  if (error instanceof UserError) return json({ error: error.message }, error.status);
  console.error(error);
  return json({ error: 'Внутренняя ошибка сервера. Изменения не сохранены — попробуйте ещё раз.' }, 500);
}

/** Wraps an endpoint so that thrown errors become readable JSON responses. */
export async function handle(fn: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    const result = await fn();
    return result instanceof Response ? result : json(result ?? { ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export function tooLarge(request: Request, max = limits.requestBytes): boolean {
  const length = Number(request.headers.get('content-length') ?? 0);
  return length > max;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (tooLarge(request, 1024 * 1024)) throw new UserError('Слишком большой запрос', 413);
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    throw new UserError('Неверный формат запроса', 400);
  }
}

export async function readForm(request: Request, max = limits.requestBytes): Promise<FormData> {
  if (tooLarge(request, max)) throw new UserError('Файл слишком большой', 413);
  try {
    return await request.formData();
  } catch {
    throw new UserError('Неверный формат запроса', 400);
  }
}

export function intParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError();
  return id;
}

/**
 * The visitor's address for rate limits. Behind a reverse proxy every request comes from the
 * proxy, so with TRUST_PROXY=true the address set by the proxy (X-Forwarded-For) is used.
 * Only enable it when the proxy overwrites that header; otherwise visitors could fake it.
 */
export function clientIp(request: Request, socketAddress: string): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded.slice(0, 64);
  }
  return socketAddress;
}
