import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'build/**', 'apps/api/drizzle/**'] },
  ...tseslint.configs.recommended,
);
