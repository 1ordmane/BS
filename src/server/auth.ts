import crypto from 'node:crypto';
import { session as sessionConfig } from './config.ts';
import { all, logActivity, now, one, run, tx } from './db.ts';
import { UserError, ValidationError } from './errors.ts';
import { isEmail } from './validate.ts';

/* ---------- Passwords: scrypt with a per-password salt ---------- */

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the e-mail is unknown, so a failed login takes the same time either way.
const decoyHash = hashPassword(crypto.randomBytes(16).toString('hex'));

export function validatePassword(password: string): string | null {
  if (password.length < 12) return 'Пароль должен быть не короче 12 символов';
  if (password.length > 200) return 'Слишком длинный пароль';
  return null;
}

/* ---------- Users ---------- */

export interface User {
  id: number;
  email: string;
  name: string;
}

export function countUsers(): number {
  return Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n);
}

export function createUser(email: string, password: string, name = ''): User {
  const normalized = email.trim().toLowerCase();
  if (!isEmail(normalized)) throw new ValidationError({ email: 'Введите корректный адрес почты' });
  const problem = validatePassword(password);
  if (problem) throw new ValidationError({ password: problem });
  if (one('SELECT id FROM users WHERE email = ?', normalized)) {
    throw new ValidationError({ email: 'Пользователь с такой почтой уже есть' });
  }
  const time = now();
  const { lastInsertRowid } = run(
    'INSERT INTO users (email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    normalized,
    name.trim(),
    hashPassword(password),
    time,
    time,
  );
  return { id: lastInsertRowid, email: normalized, name: name.trim() };
}

export function setPassword(userId: number, password: string, keepSessionId?: string): void {
  const problem = validatePassword(password);
  if (problem) throw new ValidationError({ password: problem });
  tx(() => {
    run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), now(), userId);
    // Changing the password signs out every other device.
    run('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?', userId, keepSessionId ?? null);
  });
}

export function changePassword(userId: number, current: string, next: string, keepSessionId: string): void {
  const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId);
  if (!row || !verifyPassword(current, row.password_hash)) {
    throw new ValidationError({ current: 'Текущий пароль указан неверно' });
  }
  setPassword(userId, next, keepSessionId);
  logActivity(userId, 'password', 'Пароль изменён');
}

/* ---------- Rate limiting (fixed window, stored in the database) ---------- */

/** Counts an event and returns false once the limit for the window is exceeded. */
export function hit(key: string, limit: number, windowMs: number): boolean {
  const time = Date.now();
  return tx(() => {
    const row = one<{ window_start: number; count: number }>('SELECT window_start, count FROM rate_limits WHERE key = ?', key);
    if (!row || time - row.window_start >= windowMs) {
      run('INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)', key, time);
      return true;
    }
    run('UPDATE rate_limits SET count = count + 1 WHERE key = ?', key);
    return row.count + 1 <= limit;
  });
}

export function isLimited(key: string, limit: number, windowMs: number): boolean {
  const row = one<{ window_start: number; count: number }>('SELECT window_start, count FROM rate_limits WHERE key = ?', key);
  return !!row && Date.now() - row.window_start < windowMs && row.count >= limit;
}

export function clearLimit(key: string): void {
  run('DELETE FROM rate_limits WHERE key = ?', key);
}

/**
 * Deletes rate-limit records (they hold visitors' IP addresses) older than 23 hours. Runs every
 * 30 minutes (middleware.ts) and on each inquiry, so no record lives longer than a day — the
 * privacy policy promises that.
 */
export function pruneRateLimits(): void {
  run('DELETE FROM rate_limits WHERE window_start < ?', Date.now() - 23 * 60 * 60 * 1000);
}

/* ---------- Login ---------- */

const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_PER_ACCOUNT = 5;
const LOGIN_PER_ADDRESS = 20;

/** Checks the credentials, with lockouts per account and per client address. */
export function authenticate(email: string, password: string, address: string): User {
  const normalized = email.trim().toLowerCase();
  const accountKey = `login:account:${normalized}`;
  const addressKey = `login:address:${address}`;

  if (isLimited(accountKey, LOGIN_PER_ACCOUNT, LOGIN_WINDOW) || isLimited(addressKey, LOGIN_PER_ADDRESS, LOGIN_WINDOW)) {
    throw new UserError('Слишком много попыток входа. Подождите 15 минут и попробуйте снова.', 429);
  }

  const user = one<User & { password_hash: string }>('SELECT id, email, name, password_hash FROM users WHERE email = ?', normalized);
  const valid = verifyPassword(password, user?.password_hash ?? decoyHash) && !!user;

  if (!valid) {
    hit(accountKey, LOGIN_PER_ACCOUNT, LOGIN_WINDOW);
    hit(addressKey, LOGIN_PER_ADDRESS, LOGIN_WINDOW);
    throw new UserError('Неверный логин или пароль', 401);
  }

  clearLimit(accountKey);
  return { id: user.id, email: user.email, name: user.name };
}

/* ---------- Sessions ---------- */

export interface Session {
  id: string;
  user: User;
  csrfToken: string;
}

function digest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export function createSession(userId: number, userAgent: string): { token: string; session: Session } {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = digest(token);
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const time = Date.now();
  run(
    'INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    userId,
    csrfToken,
    time,
    time,
    time + sessionConfig.maxAgeMs,
    userAgent.slice(0, 300),
  );
  run('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?', time, time - sessionConfig.idleMs);
  const user = one<User>('SELECT id, email, name FROM users WHERE id = ?', userId)!;
  return { token, session: { id, user, csrfToken } };
}

export function readSession(token: string | undefined): Session | null {
  if (!token || token.length > 100) return null;
  const id = digest(token);
  const row = one<{ csrf_token: string; last_seen_at: number; expires_at: number; user_id: number; email: string; name: string }>(
    `SELECT s.csrf_token, s.last_seen_at, s.expires_at, u.id AS user_id, u.email, u.name
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    id,
  );
  if (!row) return null;
  const time = Date.now();
  if (row.expires_at < time || row.last_seen_at < time - sessionConfig.idleMs) {
    run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  // Refresh the idle timer at most once a minute.
  if (time - row.last_seen_at > 60_000) run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', time, id);
  return { id, csrfToken: row.csrf_token, user: { id: row.user_id, email: row.email, name: row.name } };
}

export function destroySession(id: string): void {
  run('DELETE FROM sessions WHERE id = ?', id);
}

export function destroyOtherSessions(userId: number, keepId: string): number {
  return run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, keepId).changes;
}

export function listSessions(userId: number): { id: string; created_at: number; last_seen_at: number; user_agent: string }[] {
  return all('SELECT id, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', userId);
}

export function checkCsrf(session: Session, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(session.csrfToken);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
