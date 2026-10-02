// 푸터(스펙22 §2.19). 정체성·건강 안내 + 크레딧 링크 — 크레딧은 항상(23 plan D6, /credits 항상 생성).
import { COPY } from '@ws/copy';

export default function Footer() {
  return (
    <footer className="ws-footer">
      <p>{COPY.footer.identity}</p>
      <p>{COPY.footer.health}</p>
      <p>
        <a href="/credits">{COPY.credits.footerLink}</a>
      </p>
    </footer>
  );
}
