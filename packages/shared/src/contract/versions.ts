// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 10,
  'C-sync': 2,
  'C-mutators': 6,
  'C-modules': 12,
  'C-http': 12,
} as const;
