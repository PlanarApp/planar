// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 2,
  'C-sync': 1,
  'C-mutators': 1,
  'C-modules': 1,
  'C-http': 3,
} as const;
