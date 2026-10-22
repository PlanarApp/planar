import { createApp } from './app.js';

const app = await createApp({
  databaseUrl: process.env.DATABASE_URL ?? '',
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});
await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
