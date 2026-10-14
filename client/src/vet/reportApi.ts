// 병원 제보 전송(계약 C-R5-4, D15): POST /api/vets/reports(동일 출처 상대 경로만) → 202 접수.
//   제보된 병원은 목록·지도·배지 어디에도 나타나지 않는다(운영자 전화 확인 전 비노출). 좌표·이메일·제보자 정보 0.
export interface VetReportBody {
  name: string;
  address: string;
  phone: string;
  treats: string[];
}

export type VetReportResult = 'ok' | 'invalid' | 'rate' | 'error';

export const VET_REPORT_ENDPOINT = '/api/vets/reports';
export const VET_REPORT_LIMITS = { name: 60, address: 120, treats: 6 } as const;

const PHONE_RE = /^(?=(?:.*\d){9})[0-9-]{9,13}$/;
const PHONE_SHAPE_RE = /^\d[0-9-]*\d$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f<>]|:\/\//;

function cleanText(v: string, max: number): string | null {
  const t = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  return t.length === 0 || t.length > max || UNSAFE_TEXT_RE.test(t) ? null : t;
}

export type VetReportField = 'name' | 'address' | 'phone' | 'treats';

/** 서버 parseVetReport 와 같은 규칙(사전 검사 — 서버가 최종). 위반 필드 목록, 통과면 body. */
export function validateVetReport(input: VetReportBody): { body: VetReportBody; invalid: [] } | { body: null; invalid: VetReportField[] } {
  const invalid: VetReportField[] = [];
  const name = cleanText(input.name, VET_REPORT_LIMITS.name);
  const address = cleanText(input.address, VET_REPORT_LIMITS.address);
  const phone = input.phone.trim();
  const treats = [...new Set(input.treats)];
  if (name === null) invalid.push('name');
  if (address === null) invalid.push('address');
  if (!PHONE_RE.test(phone) || !PHONE_SHAPE_RE.test(phone) || phone.includes('--')) invalid.push('phone');
  if (treats.length > VET_REPORT_LIMITS.treats) invalid.push('treats');
  if (invalid.length > 0 || name === null || address === null) return { body: null, invalid };
  return { body: { name, address, phone, treats }, invalid: [] };
}

/** 테스트는 send 를 바꿔 끼운다. 네트워크 실패·5xx = 'error', 429 = 'rate', 400·415 = 'invalid'. */
export const vetReportApi = {
  async send(body: VetReportBody): Promise<VetReportResult> {
    if (typeof fetch !== 'function') return 'error';
    try {
      const res = await fetch(VET_REPORT_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 202 || res.status === 200) return 'ok';
      if (res.status === 429) return 'rate';
      if (res.status === 400 || res.status === 415) return 'invalid';
      return 'error';
    } catch {
      return 'error';
    }
  },
};
