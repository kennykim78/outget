// 푸터(스펙22 §2.19). 정체성·건강 안내 + 크레딧 링크 — 크레딧은 항상(23 plan D6, /credits 항상 생성)
//   + 개인정보 처리방침 링크 항상(계획 86 P8). 마크업·순서는 서버 프리렌더 renderFooter(server/src/prerender/pages/common.ts)와
//   같아야 한다(하이드레이션 후 동일 — prerenderParity 푸터 테스트). 처리방침 강조(600)는 CSS(.ws-footer a[href='/privacy']).
import { COPY } from '@ws/copy';

export default function Footer() {
  return (
    <footer className="ws-footer">
      <p>{COPY.footer.identity}</p>
      <p>{COPY.footer.health}</p>
      <p>
        <a href="/privacy">{COPY.footer.privacy}</a>
        {' · '}
        <a href="/credits">{COPY.credits.footerLink}</a>
      </p>
    </footer>
  );
}
