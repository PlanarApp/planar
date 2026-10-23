// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 4,
  'C-sync': 1,
  'C-mutators': 2,
  'C-modules': 2,
  'C-http': 5,
} as const;
