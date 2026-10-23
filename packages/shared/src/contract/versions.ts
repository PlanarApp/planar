// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 8,
  'C-sync': 2,
  'C-mutators': 3,
  'C-modules': 6,
  'C-http': 10,
} as const;
