/**
 * Restores a backup. STOP THE SITE FIRST, then:
 *
 *   npm run restore -- <backup name>      (names: npm run restore -- --list)
 *
 * The current data is moved to DATA_DIR/replaced-<date>, not deleted.
 */
import { listBackups, restoreBackup } from '../src/server/backup.ts';
import { closeDb } from '../src/server/db.ts';

const name = process.argv[2];
try {
  if (!name || name === '--list') {
    for (const backup of listBackups()) console.log(`${backup.name}  schema ${backup.schema}  ${(backup.bytes / 1024 / 1024).toFixed(1)} MB`);
    if (!name) console.log('\nUsage: npm run restore -- <backup name>');
  } else {
    const aside = restoreBackup(name);
    console.log(`Restored ${name}. Previous data kept in ${aside}. Start the site again.`);
  }
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
