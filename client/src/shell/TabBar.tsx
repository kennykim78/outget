// 하단 탭바(스펙22 §2.3, ≤767 표시 — CSS). 홈 = 셸 동물 있으면 /{slug}(D-6) 없으면 /, 용품 /supplies, 병원 /vet.
//   아이콘 = 보드 SVG(viewBox 24, stroke 2, 22px, currentColor, 장식) — 프리렌더 common.ts TAB_ICONS 와 같은 경로(26 F7).
import { COPY } from '@ws/copy';
import type { NavCurrent } from './shellType';

const ICONS = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  supplies: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  vet: (
    <>
      <path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
} as const;

type TabKey = keyof typeof ICONS;

function Tab({ k, href, label, current }: { k: TabKey; href: string; label: string; current: NavCurrent }) {
  return (
    <a className="ws-tab" href={href} aria-current={current === k ? 'page' : undefined}>
      <svg
        className="ws-tab-icon"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        {ICONS[k]}
      </svg>
      <span className="ws-tab-label">{label}</span>
    </a>
  );
}

export interface TabBarProps {
  homeHref: string;
  current: NavCurrent;
}

export default function TabBar({ homeHref, current }: TabBarProps) {
  return (
    <nav className="ws-tabbar">
      <Tab k="home" href={homeHref} label={COPY.nav.tabHome} current={current} />
      <Tab k="supplies" href="/supplies" label={COPY.nav.tabSupplies} current={current} />
      <Tab k="vet" href="/vet" label={COPY.nav.tabVet} current={current} />
    </nav>
  );
}
