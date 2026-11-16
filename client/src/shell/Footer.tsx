// 푸터(U2b · Kenny D3 최소 범위 2026-11-14, R3 시안 v1b). 로고 · 한 줄 소개 · 개인정보 처리방침(항상 — 계획 86 P8) ·
//   사진 출처(/credits 항상 — 23 plan D6, 불변식 ① 사용권 공개) · 「의료 판단을 대신하지 않아요」(불변식 ⑤) · ©. 소개·문의 링크 없음(D3).
//   마크업·순서는 서버 프리렌더 renderFooter(server/src/prerender/pages/common.ts)와 같아야 한다(prerenderParity 푸터 테스트).
//   처리방침 강조(600)는 CSS(.ws-footer a[href='/privacy']).
import { COPY } from '@ws/copy';
import AffNote from '../supply/AffNote';

/**
 * affNote(R4-3, R4 시안 affiliate_candidates): 지금 화면(열린 L4·L7)에 제휴 링크가 그려질 때만 © 바로 앞에 제휴 고지 F — 원문 한 문장, 접힘 없음.
 *   판정은 supply/searchLinks layerAffiliateOn(서버 renderFooter(affOn) 와 같은 규칙). 꺼짐이면 이전과 같은 DOM.
 */
export default function Footer({ affNote = false }: { affNote?: boolean }) {
  return (
    <footer className="ws-footer">
      <p className="ws-footer-brand">
        <span className="ws-footer-logo">{COPY.nav.logo}</span> <span className="ws-footer-tagline">{COPY.footer.tagline}</span>
      </p>
      <p className="ws-footer-links">
        <a href="/privacy">{COPY.footer.privacy}</a> <a href="/credits">{COPY.credits.footerLink}</a>
      </p>
      <p className="ws-footer-note">{COPY.footer.medical}</p>
      {affNote ? <AffNote kind="f" /> : null}
      <p className="ws-footer-copy">{COPY.footer.copyright}</p>
    </footer>
  );
}
