/** MAX_UPLOAD_MB: пусто/не задано → 50; нечисло или ≤ 0 → ошибка. */
export function parseMaxUploadMb(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 50;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`MAX_UPLOAD_MB: ожидается число > 0, получено "${raw}"`);
  return n;
}
