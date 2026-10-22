import { inject } from 'vitest';
import { createDb, type Db } from '../src/db/index.js';

/** URL свежей тестовой базы (планируется globalSetup). */
export const testDbUrl = () => inject('dbUrl');

/** Пул к тестовой базе; закрыть: await db.$client.end(). */
export const testDb = (): Db => createDb(testDbUrl());
