// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 8,
  'C-sync': 2,
  'C-mutators': 4,
  'C-modules': 8,
  'C-http': 10,
} as const;
