import { createApp } from './app.js';
import {
  parseDbPoolMax,
  parseDemoMode,
  parseDemoResetHours,
  parseMaxUploadMb,
  parseTrustProxy,
} from './config.js';
import { createDb, migrate } from './db/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}
let maxUploadMb: number;
let trustProxy: string[];
let dbPoolMax: number;
let demo: boolean;
let demoResetHours: number;
try {
  trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  dbPoolMax = parseDbPoolMax(process.env.DB_POOL_MAX);
  demo = parseDemoMode(process.env.DEMO_MODE);
  demoResetHours = parseDemoResetHours(process.env.DEMO_RESET_HOURS);
  // demo: 2 MB unless MAX_UPLOAD_MB is set explicitly
  const upload = process.env.MAX_UPLOAD_MB;
  maxUploadMb = parseMaxUploadMb(demo && !upload?.trim() ? '2' : upload);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
// cloud-link: both or neither (CLOUD_URL without the token cannot reach the cloud)
const cloudUrl = process.env.CLOUD_URL?.trim().replace(/\/+$/, '');
const cloudToken = process.env.CLOUD_TOKEN?.trim();
if (!!cloudUrl !== !!cloudToken) {
  console.error('CLOUD_URL и CLOUD_TOKEN задаются вместе');
  process.exit(1);
}
const cloud = cloudUrl && cloudToken ? { url: cloudUrl, token: cloudToken } : undefined;
const migrationDb = createDb(databaseUrl);
await migrate(migrationDb).finally(() => migrationDb.$client.end());
const app = await createApp({
  databaseUrl,
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:5173',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  dataDir: process.env.DATA_DIR,
  maxUploadMb: maxUploadMb,
  trustProxy,
  setupToken: process.env.SETUP_TOKEN || undefined,
  dbPoolMax,
  demo,
  demoResetHours,
  cloud,
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
