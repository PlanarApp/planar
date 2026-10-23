import { createApp } from './app.js';
import { createDb, migrate } from './db/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}
const migrationDb = createDb(databaseUrl);
await migrate(migrationDb).finally(() => migrationDb.$client.end());
const app = await createApp({
  databaseUrl,
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5173',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  dataDir: process.env.DATA_DIR,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 50),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
