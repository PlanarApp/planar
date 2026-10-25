import { createApp } from './app.js';
import { parseMaxUploadMb, parseTrustProxy } from './config.js';
import { createDb, migrate } from './db/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}
let maxUploadMb: number;
let trustProxy: string[];
try {
  trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  maxUploadMb = parseMaxUploadMb(process.env.MAX_UPLOAD_MB);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const migrationDb = createDb(databaseUrl);
await migrate(migrationDb).finally(() => migrationDb.$client.end());
const app = await createApp({
  databaseUrl,
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5173',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  dataDir: process.env.DATA_DIR,
  maxUploadMb: maxUploadMb,
  trustProxy,
  push: {
    boss: true,
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT,
    },
  },
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
