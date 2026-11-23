/**
 * Creates a backup in DATA_DIR/backups: database, uploaded images and inquiry attachments.
 * Safe to run while the site is running. Keeps the 14 most recent backups.
 *
 *   npm run backup
 */
import { createBackup, listBackups } from '../src/server/backup.ts';
import { closeDb } from '../src/server/db.ts';

try {
  const backup = createBackup(process.argv[2] ?? 'cli');
  console.log(`Backup created: ${backup.name} (${(backup.bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Backups on disk: ${listBackups().length}. Copy them off this server regularly.`);
} finally {
  closeDb();
}
