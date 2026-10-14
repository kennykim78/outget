// VetCard(스펙33 §4) — /vet 목록 · 홈 B ④ 레일 공용. 마크업은 프리렌더 vetCard(server/src/prerender/pages/common.ts)와 같은 순서:
//   li.ws-vet[data-ws-id] → h3 병원명 → 확인 배지(verifiedAt 있을 때만 "✓ 전화 확인 YYYY.MM") → 주소 → 전화번호(meta, DR m-5) → 진료 동물(노출 타입 표시명만,
//   원시 id 0) → 야간·응급 칩(true 만) → [전화](tel:) [길찾기](engine naverMapSearchUrl — 지도 웹 딥링크를 만드는 유일한 경로).
//   "제보됨" 배지 없음(D15 — 제보 병원은 애초에 목록에 오지 않는다). 거리·좌표·"진료 가능" 단정 0(불변식 ⑤⑧). 마스코트 0.
//   onSelect 가 있으면(/vet) 병원명이 선택 버튼 — 지도 이동용, 전화·길찾기는 선택하지 않는다.
import { naverMapSearchUrl, type PublicVet } from '@ws/engine';
import { track } from '../events/track';
import Glyph from '../ui/Glyph';
import { copyAt } from '../ui/copyText';
import '../styles/vet.css';

export interface VetCardProps {
  vet: PublicVet;
  /** 노출 타입 id → 표시명. 없으면 진료 동물 줄 생략(원시 id 를 그리지 않는다). */
  typeNames?: ReadonlyMap<string, string>;
  selected?: boolean;
  onSelect?(id: string): void;
  /** 병원명 제목 레벨 — 기본 3(홈 B 섹션 h2 아래), /vet 은 목록 위 h2 가 없어 2 를 전달. */
  level?: 2 | 3;
}

/** 'YYYY-MM-DD…' → 'YYYY.MM'. */
export function yearMonth(d: string | null): string | null {
  return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? `${d.slice(0, 4)}.${d.slice(5, 7)}` : null;
}

export function telHref(phone: string): string | null {
  const t = phone.replace(/[^0-9+]/g, '');
  return t === '' ? null : `tel:${t}`;
}

export default function VetCard({ vet, typeNames, selected = false, onSelect, level = 3 }: VetCardProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const ym = yearMonth(vet.verifiedAt);
  const badge = copyAt('vet.verifiedBadge');
  const treatsLabel = copyAt('vet.treats');
  const treats = typeNames ? vet.treats.map((id) => typeNames.get(id)).filter((x): x is string => typeof x === 'string') : [];
  const flags = [vet.night === true ? copyAt('vet.night') : null, vet.emergency === true ? copyAt('vet.emergency') : null].filter(
    (x): x is string => x !== null,
  );
  const tel = telHref(vet.phone);
  const call = copyAt('vet.call');
  const route = copyAt('vet.directions');

  return (
    <li
      className={`ws-vet${selected ? ' ws-vet--selected' : ''}`}
      data-ws-id={`vetClinics#${vet.id}`}
      aria-current={selected ? 'true' : undefined}
    >
      <Heading>
        {onSelect ? (
          <button
            type="button"
            aria-pressed={selected}
            className="ws-vet-name"
            onClick={() => {
              onSelect(vet.id);
              track('vet_clicked', { clinicId: vet.id, action: 'detail' });
            }}
          >
            {vet.name}
          </button>
        ) : (
          vet.name
        )}
      </Heading>
      {ym && badge ? (
        <p className="ws-vet-badge">
          <Glyph kind="ready" />
          {badge} {ym}
        </p>
      ) : null}
      <p className="ws-vet-address">{vet.address}</p>
      {vet.phone !== '' ? <p className="ws-vet-phone">{vet.phone}</p> : null}
      {treats.length > 0 && treatsLabel ? (
        <p className="ws-vet-treats">
          {treatsLabel}: {treats.join(' · ')}
        </p>
      ) : null}
      {flags.length > 0 ? (
        <p className="ws-vet-flags">
          {flags.map((f) => (
            <span key={f} className="ws-chip">
              {f}
            </span>
          ))}
        </p>
      ) : null}
      <p className="ws-vet-actions">
        {tel && call ? (
          <a
            className="ws-btn ws-btn--outline"
            href={tel}
            aria-label={`${call} ${vet.phone}`}
            data-ws-action="vet-call"
            onClick={() => track('vet_clicked', { clinicId: vet.id, action: 'call' })}
          >
            {call}
          </a>
        ) : null}
        {route ? (
          <a
            className="ws-btn ws-btn--outline"
            href={naverMapSearchUrl(`${vet.name} ${vet.address}`)}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-ws-action="vet-route"
            onClick={() => track('vet_clicked', { clinicId: vet.id, action: 'route' })}
          >
            {route}
          </a>
        ) : null}
      </p>
    </li>
  );
}
