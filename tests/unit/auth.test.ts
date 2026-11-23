import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempData } from '../helpers.ts';

useTempData();
const auth = await import('../../src/server/auth.ts');
const { run } = await import('../../src/server/db.ts');
const { ValidationError, UserError } = await import('../../src/server/errors.ts');

test('passwords are hashed with a salt and verified', () => {
  const a = auth.hashPassword('correct horse battery');
  const b = auth.hashPassword('correct horse battery');
  assert.notEqual(a, b, 'same password, different salt');
  assert.ok(a.startsWith('scrypt$'));
  assert.ok(!a.includes('correct'));
  assert.equal(auth.verifyPassword('correct horse battery', a), true);
  assert.equal(auth.verifyPassword('wrong', a), false);
});

test('users need a valid e-mail and a password of at least 12 characters', () => {
  assert.throws(() => auth.createUser('not-an-email', 'long-enough-password'), ValidationError);
  assert.throws(() => auth.createUser('a@b.ru', 'short'), ValidationError);
  const user = auth.createUser('Admin@Example.ru', 'long-enough-password');
  assert.equal(user.email, 'admin@example.ru');
  assert.throws(() => auth.createUser('admin@example.ru', 'another-long-password'), ValidationError);
});

test('login: wrong password is refused, right one accepted', () => {
  assert.throws(() => auth.authenticate('admin@example.ru', 'nope-nope-nope', '1.1.1.1'), (e: unknown) => e instanceof UserError && e.status === 401);
  assert.throws(() => auth.authenticate('nobody@example.ru', 'whatever-password', '1.1.1.1'), (e: unknown) => e instanceof UserError && e.status === 401);
  assert.equal(auth.authenticate('ADMIN@example.ru', 'long-enough-password', '1.1.1.1').email, 'admin@example.ru');
});

test('login is locked after 5 failures for the account, even with the right password', () => {
  auth.createUser('locked@example.ru', 'long-enough-password');
  for (let i = 0; i < 5; i += 1) {
    assert.throws(() => auth.authenticate('locked@example.ru', 'wrong-password!', `10.0.0.${i}`));
  }
  assert.throws(
    () => auth.authenticate('locked@example.ru', 'long-enough-password', '10.0.0.99'),
    (e: unknown) => e instanceof UserError && e.status === 429,
  );
});

test('sessions: token is not stored, CSRF token checked, idle sessions expire', () => {
  const user = auth.createUser('session@example.ru', 'long-enough-password');
  const { token, session } = auth.createSession(user.id, 'test-agent');
  assert.notEqual(session.id, token, 'only a hash of the token is stored');
  const read = auth.readSession(token);
  assert.equal(read?.user.email, 'session@example.ru');
  assert.equal(auth.checkCsrf(read!, read!.csrfToken), true);
  assert.equal(auth.checkCsrf(read!, 'forged'), false);
  assert.equal(auth.checkCsrf(read!, null), false);
  assert.equal(auth.readSession('made-up-token'), null);

  run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', Date.now() - 13 * 60 * 60 * 1000, session.id);
  assert.equal(auth.readSession(token), null, 'idle session expired');
});

test('changing the password ends the other sessions', () => {
  const user = auth.createUser('change@example.ru', 'long-enough-password');
  const current = auth.createSession(user.id, 'a');
  const other = auth.createSession(user.id, 'b');
  assert.throws(() => auth.changePassword(user.id, 'wrong-current-pw', 'new-long-password-1', current.session.id), ValidationError);
  auth.changePassword(user.id, 'long-enough-password', 'new-long-password-1', current.session.id);
  assert.ok(auth.readSession(current.token));
  assert.equal(auth.readSession(other.token), null);
  assert.equal(auth.authenticate('change@example.ru', 'new-long-password-1', '2.2.2.2').id, user.id);
});

test('rate limit counts within a window', () => {
  assert.equal(auth.hit('k', 2, 60_000), true);
  assert.equal(auth.hit('k', 2, 60_000), true);
  assert.equal(auth.hit('k', 2, 60_000), false);
});
