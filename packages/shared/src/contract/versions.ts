// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 3,
  'C-sync': 1,
  'C-mutators': 2,
  'C-modules': 1,
  'C-http': 3,
} as const;
