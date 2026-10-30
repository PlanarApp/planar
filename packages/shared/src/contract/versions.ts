// Версии контрактов = заголовки `## C-… vN` в docs/contracts/core.md (сверяет contract.test.ts).
export const CONTRACT_VERSIONS = {
  'C-schema': 13,
  'C-sync': 2,
  'C-mutators': 9,
  'C-modules': 12,
  'C-http': 12,
} as const;
