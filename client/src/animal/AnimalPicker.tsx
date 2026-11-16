// L1 친구 선택(스펙22 §3.3 · §2.12 TypeCard, PRD US-001·002). 스텝: 그룹 2 → 타입 격자 → "잘 모르겠어요".
//   노출 타입(ws-data data.types)만 그린다 — PLANNED·비노출 이름 0(불변식 ⑦, G3 결정 전 기본 미노출).
//   선택 → ws.animalType + species_selected{via: picker|alias} → /{slug} 문서 이동(D4). 마스코트 허용.
//   286 U4(D5 ①, R3 시안 + R4 fix): 그룹 단계 = 카드 선택(✓) → 하단 주 버튼 「{그룹} 친구 고르기」 → 종류 단계 push(뒤로 = 그룹).
//     채운 CTA 는 그룹 단계의 그 버튼 하나. 종류 단계는 카드 누름 = 선택 완료(기존 그대로).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ANIMAL_GROUPS, type AnimalGroup, type PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import { sanitizeQuery } from '@ws/events';
import { useLayerPage } from '../app/layerPage';
import { track } from '../events/track';
import { typeHomeHref } from '../shell/shellType';
import AnimalAvatar from '../ui/AnimalAvatar';
import { copyAt, copyFmt } from '../ui/copyText';
import { LayerFoot, useLayerChrome } from '../ui/layer/Layer';
import { layerStore, type LayerProps } from '../ui/layer/useLayer';
import { findCandidates } from './match';
import { nav } from './navigate';
import { runPickHandler } from './pickHandler';
import { useAnimalSelection, type SelectVia } from './selection';
import './picker.css';

type Step = { kind: 'groups' } | { kind: 'types'; group: AnimalGroup } | { kind: 'unsure'; from: AnimalGroup | null };

// 단계는 L1 히스토리 스텝(props.step, 문자열) — 뒤로가기 = 이전 단계, 첫 단계에서 뒤로 = 닫기(디자인 Layer README · L5→L6 와 같은 패턴).
//   'groups'(또는 없음) | 'types:{GROUP}' | 'unsure' | 'unsure:{GROUP}'. 모르는 값은 groups.
const isGroup = (v: string): v is AnimalGroup => (ANIMAL_GROUPS as readonly string[]).includes(v);

function parseStep(raw: unknown): Step {
  if (typeof raw !== 'string') return { kind: 'groups' };
  const [kind, g = ''] = raw.split(':');
  if (kind === 'types' && isGroup(g)) return { kind: 'types', group: g };
  if (kind === 'unsure') return { kind: 'unsure', from: isGroup(g) ? g : null };
  return { kind: 'groups' };
}

function stepKey(step: Step): string {
  if (step.kind === 'types') return `types:${step.group}`;
  if (step.kind === 'unsure') return step.from ? `unsure:${step.from}` : 'unsure';
  return 'groups';
}

const GROUP_MASCOT: Record<AnimalGroup, string> = { SMALL_MAMMAL: 'group-small-mammal', PARROT: 'group-parrot' };

/** 그룹 단계의 처음 선택: 저장된 친구의 그룹 → 노출 타입이 있는 첫 그룹 → 첫 그룹(노출 데이터에서만 정한다). */
function initialGroup(types: readonly PublicAnimalType[], typeId: string | null): AnimalGroup {
  const saved = typeId ? types.find((t) => t.id === typeId) : undefined;
  if (saved) return saved.group;
  return ANIMAL_GROUPS.find((g) => types.some((t) => t.group === g)) ?? ANIMAL_GROUPS[0];
}

/** "‹ 그룹 선택" 에서 레이어 머리가 붙이는 "‹ " 를 뺀 이름. */
const backToGroupsLabel = (): string => COPY.picker.backToGroups.replace(/^‹\s*/, '');

function UnsureRow({ onOpen }: { onOpen(): void }) {
  const hint = copyAt('picker.searchHint');
  return (
    <button type="button" className="ws-picker-unsure" data-ws-action="unsure" onClick={onOpen}>
      <span className="ws-picker-unsure-text">
        <span className="ws-t-cta">{COPY.picker.unsure}</span>
        {hint ? <span className="ws-t-meta ws-picker-muted">{hint}</span> : null}
      </span>
      <span className="ws-picker-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export default function AnimalPicker({ props, close }: { props: LayerProps; close(): void }) {
  const page = useLayerPage();
  const types = page.data.types;
  const chrome = useLayerChrome();
  const selection = useAnimalSelection(types);
  const key = stepKey(parseStep(props.step));
  const step = useMemo(() => parseStep(key), [key]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<AnimalGroup>(() => initialGroup(types, selection.typeId));
  const reported = useRef(new Set<string>());
  /** 이 L1 인스턴스가 지나온 단계(히스토리 항목과 1:1). 길이 1 = 진입 단계 → ‹ 는 뒤로 대신 교체. */
  const trail = useRef<string[]>([key]);

  useEffect(() => {
    const t = trail.current;
    if (t[t.length - 1] === key) return;
    if (t.length > 1 && t[t.length - 2] === key) t.pop(); // 뒤로가기·‹
    else t.push(key); // push 또는 브라우저 앞으로
  }, [key]);

  // 종류 단계에서 뒤로 오면 들어갔던 그룹이 선택된 채로(딥링크 종류 단계 포함).
  useEffect(() => {
    if (step.kind === 'types') setGroup(step.group);
  }, [step]);

  /** 다음 단계로: 같은 URL 에 L1 스텝 push(뒤로 = 이 단계). */
  function pushStep(next: Step): void {
    const k = stepKey(next);
    layerStore.open('L1', k === 'groups' ? {} : { step: k });
  }

  /** ‹ 이전 단계: 지나온 단계가 있으면 history 뒤로, 진입 단계(딥링크 등)면 목표 단계로 교체. */
  function backTo(target: Step): void {
    if (trail.current.length > 1) {
      layerStore.back();
      return;
    }
    const k = stepKey(target);
    trail.current = [k];
    layerStore.open('L1', k === 'groups' ? {} : { step: k }, { replace: true });
  }

  /** 그룹 선택으로(0건 안내의 버튼): 지나온 groups 항목까지 되돌아가고, 없으면 교체. */
  function backToGroups(): void {
    const t = trail.current;
    const idx = t.lastIndexOf('groups');
    if (idx >= 0 && idx < t.length - 1) {
      const n = t.length - 1 - idx;
      if (n === 1) layerStore.back();
      else window.history.go(-n); // popstate → layerStore.onPopState 가 그 항목의 단계를 복원
      return;
    }
    if (key !== 'groups') backTo({ kind: 'groups' });
  }

  const backRef = useRef(backTo);
  backRef.current = backTo;

  useEffect(() => {
    const onBack = (target: Step) => () => backRef.current(target);
    if (step.kind === 'groups') {
      chrome.setTitle(COPY.picker.title);
      chrome.setBack(null);
    } else if (step.kind === 'types') {
      chrome.setTitle(COPY.groups[step.group]);
      chrome.setBack({ label: backToGroupsLabel(), onBack: onBack({ kind: 'groups' }) });
    } else {
      const from = step.from;
      chrome.setTitle(COPY.picker.unsure);
      chrome.setBack(
        from
          ? { label: COPY.groups[from], onBack: onBack({ kind: 'types', group: from }) }
          : { label: backToGroupsLabel(), onBack: onBack({ kind: 'groups' }) },
      );
    }
  }, [step, chrome]);

  const candidates = useMemo(() => findCandidates(types, query), [types, query]);
  const cleaned = sanitizeQuery(query);

  function choose(type: PublicAnimalType, via: SelectVia): void {
    selection.select(type.id, via);
    if (runPickHandler(type, via)) return; // 여는 쪽이 이동을 맡음(이중 이동 방지)
    const href = typeHomeHref(type);
    if (window.location.pathname === href) close();
    else nav.assign(href);
  }

  function reportUnknown(): void {
    if (cleaned === '' || candidates.length > 0 || reported.current.has(cleaned)) return;
    reported.current.add(cleaned);
    track('unknown_species_clicked', { query: cleaned });
  }

  function openUnsure(from: AnimalGroup | null): void {
    setQuery('');
    pushStep({ kind: 'unsure', from });
  }

  if (step.kind === 'groups') {
    const cta = copyFmt('picker.groupCta', { name: COPY.groups[group] }) ?? COPY.groups[group];
    return (
      <>
        <div className="ws-layer-body ws-picker" data-ws-step="groups">
          <p className="ws-t-body ws-picker-muted">{COPY.picker.groupsLead}</p>
          <ul className="ws-picker-grid ws-picker-grid--groups">
            {ANIMAL_GROUPS.map((g) => {
              const selected = g === group;
              return (
                <li key={g}>
                  <button
                    type="button"
                    className={`ws-picker-group${selected ? ' ws-picker-group--selected' : ''}`}
                    data-ws-group={g}
                    aria-pressed={selected}
                    onClick={() => setGroup(g)}
                  >
                    {/* 사진 자리 = 그룹 마스코트(리포 자산, 생성 사진 금지 — 불변식 ①). 자산이 자체 원을 가진다(F10). */}
                    <span className="ws-picker-group-media">
                      <img className="ws-picker-group-img" src={`/mascots/${GROUP_MASCOT[g]}.svg`} width={96} height={96} alt="" decoding="async" />
                    </span>
                    <span className="ws-picker-group-label">
                      {selected ? (
                        <span className="ws-picker-group-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                      <span className="ws-t-section" data-ws-name="">
                        {COPY.groups[g]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="ws-t-body ws-picker-muted">{COPY.picker.groupsNext}</p>
        </div>
        <LayerFoot>
          <div className="ws-picker-foot">
            <button type="button" className="ws-btn ws-btn--fill" data-ws-action="pick-group" onClick={() => pushStep({ kind: 'types', group })}>
              {cta}
            </button>
            <button type="button" className="ws-picker-unsure-link ws-t-meta" data-ws-action="unsure" onClick={() => openUnsure(null)}>
              {COPY.picker.unsure}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (step.kind === 'types') {
    const list = types.filter((t) => t.group === step.group);
    return (
      <div className="ws-layer-body ws-picker" data-ws-step="types">
        {list.length > 0 ? (
          <ul className="ws-picker-grid">
            {list.map((t) => {
              const selected = selection.typeId === t.id;
              const alias = t.aliases[0] ? copyFmt('homeB.aliasLine', { alias: t.aliases[0] }) : null;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`ws-type-card${selected ? ' ws-type-card--selected' : ''}`}
                    data-ws-type={t.id}
                    aria-pressed={selected}
                    onClick={() => choose(t, 'picker')}
                  >
                    <AnimalAvatar asset={t.mascot} size="type" tone={selected ? 'surface' : 'brand-soft'} alt="" />
                    <span className="ws-t-cta">{t.displayName}</span>
                    {alias ? <span className="ws-t-meta ws-picker-muted">{alias}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ws-t-body ws-picker-muted" data-ws-empty="types">
            {COPY.planned.title}
          </p>
        )}
        <UnsureRow onOpen={() => openUnsure(step.group)} />
      </div>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    reportUnknown();
  };
  const hint = copyAt('picker.searchHint');
  return (
    <div className="ws-layer-body ws-picker" data-ws-step="unsure">
      <form className="ws-picker-search" role="search" onSubmit={onSubmit}>
        <label className="ws-t-label" htmlFor="ws-picker-q">
          {hint ?? COPY.picker.unsure}
        </label>
        <input
          id="ws-picker-q"
          className="ws-picker-input ws-t-body"
          type="search"
          autoComplete="off"
          maxLength={40}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <p className="ws-t-meta ws-picker-muted" data-ws-note="candidate">
        {COPY.picker.candidateNote}
      </p>
      {cleaned === '' ? null : candidates.length > 0 ? (
        <ul className="ws-picker-cands" aria-live="polite">
          {candidates.map(({ type, matchedAlias }) => (
            <li key={type.id} className="ws-picker-cand" data-ws-type={type.id}>
              <AnimalAvatar asset={type.mascot} size="md" tone="brand-soft" alt="" />
              <span className="ws-picker-cand-text">
                <span className="ws-t-cta">{type.displayName}</span>
                {matchedAlias || type.aliases[0] ? (
                  <span className="ws-t-meta ws-picker-muted">
                    {copyFmt('homeB.aliasLine', { alias: matchedAlias ?? type.aliases[0] })}
                  </span>
                ) : null}
              </span>
              <button type="button" className="ws-btn ws-btn--outline" onClick={() => choose(type, 'alias')}>
                {COPY.picker.confirm}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ws-picker-none" aria-live="polite" data-ws-empty="candidates">
          {/* MINOR-7: 일치 0건은 "준비 중"이 아니라 "목록에 없음"(팬더·고양이도 나중 지원처럼 읽히지 않게).
              PLANNED 타입은 클라이언트 데이터에 없으므로(불변식 ⑦·G3) 검색으로 PLANNED 일치를 판별할 수 없다. */}
          <p className="ws-t-body">{COPY.picker.noMatch}</p>
          <button
            type="button"
            className="ws-btn ws-btn--outline"
            onClick={() => {
              reportUnknown();
              backToGroups();
            }}
          >
            {COPY.picker.backToGroups}
          </button>
        </div>
      )}
    </div>
  );
}
