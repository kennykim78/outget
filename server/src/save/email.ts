// 이메일 정규화(계약 C-R5-2): trim → NFKC → 소문자, ≤254, 최소 형식. 실패 → null.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export const EMAIL_MAX = 254;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().normalize('NFKC').toLowerCase();
  if (e.length === 0 || e.length > EMAIL_MAX) return null;
  if (CONTROL_RE.test(e) || !EMAIL_RE.test(e)) return null;
  return e;
}
