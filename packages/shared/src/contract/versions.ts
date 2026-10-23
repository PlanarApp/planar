// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 7,
  'C-sync': 1,
  'C-mutators': 3,
  'C-modules': 3,
  'C-http': 9,
} as const;
