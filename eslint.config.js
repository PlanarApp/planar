import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.pnpm-store/**', 'data/**', 'build/**', 'apps/api/drizzle/**'] },
  ...tseslint.configs.recommended,
);
