// L1 친구 선택(스펙22 §3.3 · §2.12 TypeCard, PRD US-001·002). 스텝: 그룹 2 → 타입 격자 → "잘 모르겠어요".
//   노출 타입(ws-data data.types)만 그린다 — PLANNED·비노출 이름 0(불변식 ⑦, G3 결정 전 기본 미노출).
//   선택 → ws.animalType + species_selected{via: picker|alias} → /{slug} 문서 이동(D4). 채운 CTA 없음, 마스코트 허용.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ANIMAL_GROUPS, type AnimalGroup, type PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import { sanitizeQuery } from '@ws/events';
import { useLayerPage } from '../app/layerPage';
import { track } from '../events/track';
import { typeHomeHref } from '../shell/shellType';
import AnimalAvatar from '../ui/AnimalAvatar';
import { copyAt, copyFmt } from '../ui/copyText';
import { useLayerChrome } from '../ui/layer/Layer';
import type { LayerProps } from '../ui/layer/useLayer';
import { findCandidates } from './match';
import { nav } from './navigate';
import { useAnimalSelection, type SelectVia } from './selection';
import './picker.css';

type Step = { kind: 'groups' } | { kind: 'types'; group: AnimalGroup } | { kind: 'unsure'; from: AnimalGroup | null };

const GROUP_MASCOT: Record<AnimalGroup, string> = { SMALL_MAMMAL: 'group-small-mammal', PARROT: 'group-parrot' };

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

export default function AnimalPicker({ close }: { props: LayerProps; close(): void }) {
  const page = useLayerPage();
  const types = page.data.types;
  const chrome = useLayerChrome();
  const selection = useAnimalSelection(types);
  const [step, setStep] = useState<Step>({ kind: 'groups' });
  const [query, setQuery] = useState('');
  const reported = useRef(new Set<string>());

  useEffect(() => {
    if (step.kind === 'groups') {
      chrome.setTitle(COPY.homeA.heroCta);
      chrome.setBack(null);
    } else if (step.kind === 'types') {
      chrome.setTitle(COPY.groups[step.group]);
      chrome.setBack({ label: backToGroupsLabel(), onBack: () => setStep({ kind: 'groups' }) });
    } else {
      const from = step.from;
      chrome.setTitle(COPY.picker.unsure);
      chrome.setBack(
        from
          ? { label: COPY.groups[from], onBack: () => setStep({ kind: 'types', group: from }) }
          : { label: backToGroupsLabel(), onBack: () => setStep({ kind: 'groups' }) },
      );
    }
  }, [step, chrome]);

  const candidates = useMemo(() => findCandidates(types, query), [types, query]);
  const cleaned = sanitizeQuery(query);

  function choose(type: PublicAnimalType, via: SelectVia): void {
    selection.select(type.id, via);
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
    setStep({ kind: 'unsure', from });
  }

  if (step.kind === 'groups') {
    return (
      <div className="ws-layer-body ws-picker" data-ws-step="groups">
        <ul className="ws-picker-grid ws-picker-grid--groups">
          {ANIMAL_GROUPS.map((g) => (
            <li key={g}>
              <button type="button" className="ws-type-card ws-type-card--group" data-ws-group={g} onClick={() => setStep({ kind: 'types', group: g })}>
                {/* 그룹 자산은 자체 원을 가진다 — AnimalAvatar 디스크 없이 lg 이미지 크기(설계 검수 F10). 리포 자산만. */}
                <img className="ws-picker-group-img" src={`/mascots/${GROUP_MASCOT[g]}.svg`} width={96} height={96} alt="" decoding="async" />
                <span className="ws-t-cta">{COPY.groups[g]}</span>
              </button>
            </li>
          ))}
        </ul>
        <UnsureRow onOpen={() => openUnsure(null)} />
      </div>
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
          <p className="ws-t-body">{COPY.planned.title}</p>
          <button
            type="button"
            className="ws-btn ws-btn--outline"
            onClick={() => {
              reportUnknown();
              setStep({ kind: 'groups' });
            }}
          >
            {COPY.picker.backToGroups}
          </button>
        </div>
      )}
    </div>
  );
}
