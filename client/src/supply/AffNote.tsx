// 제휴 고지(261 §1) — A: 검색 블록 안 상인 버튼 바로 위(id = 쿠팡 a 의 aria-describedby), B: 레이어 본문 첫 요소,
//   F: 페이지 하단 푸터(R4-3, R4 시안 affiliate_candidates — shell/Footer).
//   마크업은 정적판(server/src/prerender/pages/type.ts affNote)과 같다. 문구 = COPY.affiliate.coupang 원문(sent() 변환 없음).
//   그리는 쪽이 affiliateDisclosureOn 으로 판정한다 — 꺼짐이면 이 컴포넌트를 부르지 않는다(빈 자리표시자 0).
import { COPY } from '@ws/copy';

export default function AffNote({ kind, id }: { kind: 'a' | 'b' | 'f'; id?: string }) {
  return (
    <p className="ws-t-meta ws-aff-note" id={id} data-ws-aff={`note-${kind}`}>
      {COPY.affiliate.coupang}
    </p>
  );
}
