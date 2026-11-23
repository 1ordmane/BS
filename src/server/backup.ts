import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.ts';
import { closeDb, getDb, schemaVersion } from './db.ts';

/**
 * Backups are plain folders under DATA_DIR/backups: a consistent copy of the database
 * (VACUUM INTO works while the site is running) plus the uploaded media and attachments.
 * Copy them off the server regularly; a backup on the same disk does not survive the disk.
 */

const KEEP = 14;

export interface BackupInfo {
  name: string;
  createdAt: string;
  schema: number;
  bytes: number;
}

function folderSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(full) : fs.statSync(full).size;
  }
  return total;
}

export function createBackup(label = 'manual'): BackupInfo {
  const db = getDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}-${label.replace(/[^a-z0-9-]/gi, '')}`;
  const root = paths.backups();
  const temp = path.join(root, `.tmp-${name}`);
  const target = path.join(root, name);
  fs.mkdirSync(temp, { recursive: true });
  try {
    db.exec(`VACUUM INTO '${path.join(temp, 'site.db').replaceAll("'", "''")}'`);
    for (const dir of ['media', 'attachments'] as const) {
      const source = paths[dir]();
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(temp, dir), { recursive: true, filter: (src) => !path.basename(src).startsWith('.tmp-') });
      }
    }
    const info = { name, createdAt: new Date().toISOString(), schema: schemaVersion(db) };
    fs.writeFileSync(path.join(temp, 'backup.json'), JSON.stringify(info, null, 2));
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  pruneBackups();
  return { ...readInfo(name)! };
}

function readInfo(name: string): BackupInfo | null {
  const dir = path.join(paths.backups(), name);
  const file = path.join(dir, 'backup.json');
  if (!fs.existsSync(file)) return null;
  const info = JSON.parse(fs.readFileSync(file, 'utf8')) as { createdAt: string; schema: number };
  return { name, createdAt: info.createdAt, schema: info.schema, bytes: folderSize(dir) };
}

export function listBackups(): BackupInfo[] {
  const root = paths.backups();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => !name.startsWith('.'))
    .map(readInfo)
    .filter((info): info is BackupInfo => info !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneBackups(): void {
  for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(paths.backups(), old.name), { recursive: true, force: true });
}

/**
 * Replaces the current data with a backup. Run only while the site is stopped.
 * The data being replaced is moved aside, not deleted.
 */
export function restoreBackup(name: string): string {
  const source = path.join(paths.backups(), path.basename(name));
  if (!fs.existsSync(path.join(source, 'site.db'))) throw new Error(`Backup not found: ${source}`);
  closeDb();
  const aside = path.join(path.dirname(paths.db()), `replaced-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const file of ['site.db', 'site.db-wal', 'site.db-shm']) {
    const current = path.join(path.dirname(paths.db()), file);
    if (fs.existsSync(current)) fs.renameSync(current, path.join(aside, file));
  }
  for (const dir of ['media', 'attachments'] as const) {
    if (fs.existsSync(paths[dir]())) fs.renameSync(paths[dir](), path.join(aside, dir));
    if (fs.existsSync(path.join(source, dir))) fs.cpSync(path.join(source, dir), paths[dir](), { recursive: true });
  }
  fs.copyFileSync(path.join(source, 'site.db'), paths.db());
  getDb(); // applies any migrations the backup is missing
  return aside;
}
