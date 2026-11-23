/**
 * Creates an administrator, or sets a new password for an existing one.
 *
 *   npm run admin:create -- --email admin@company.ru
 *   npm run admin:create -- --email admin@company.ru --reset
 *
 * The password is asked for interactively (not echoed). For automated setups it can come
 * from the ADMIN_PASSWORD environment variable instead; it is never accepted as an argument,
 * so it does not end up in shell history.
 */
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { createUser, setPassword } from '../src/server/auth.ts';
import { closeDb, one } from '../src/server/db.ts';
import { ValidationError } from '../src/server/errors.ts';

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const reset = args.includes('--reset');

if (!args.includes('--email') || !email) {
  console.error('Usage: npm run admin:create -- --email admin@company.ru [--reset]');
  process.exit(1);
}

function ask(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Set ADMIN_PASSWORD or run the command in a terminal.');
  const first = await ask('Пароль (не короче 12 символов): ');
  const second = await ask('Повторите пароль: ');
  if (first !== second) throw new Error('Пароли не совпадают.');
  return first;
}

try {
  const password = await readPassword();
  const existing = one<{ id: number }>('SELECT id FROM users WHERE email = ?', email.trim().toLowerCase());
  if (existing) {
    if (!reset) throw new Error('Такой администратор уже есть. Чтобы сменить пароль, добавьте --reset.');
    setPassword(existing.id, password);
    console.log(`Пароль для ${email} изменён, все его сессии завершены.`);
  } else {
    const user = createUser(email, password);
    console.log(`Администратор ${user.email} создан. Вход: /admin/login`);
  }
} catch (error) {
  const message = error instanceof ValidationError ? Object.values(error.fields).join('; ') : (error as Error).message;
  console.error(`Ошибка: ${message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
