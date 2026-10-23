// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 6,
  'C-sync': 1,
  'C-mutators': 3,
  'C-modules': 2,
  'C-http': 8,
} as const;
