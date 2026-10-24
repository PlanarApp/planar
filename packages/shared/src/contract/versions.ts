// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 9,
  'C-sync': 2,
  'C-mutators': 4,
  'C-modules': 10,
  'C-http': 11,
} as const;
