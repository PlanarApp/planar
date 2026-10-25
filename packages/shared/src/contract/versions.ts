// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 9,
  'C-sync': 2,
  'C-mutators': 5,
  'C-modules': 11,
  'C-http': 11,
} as const;
