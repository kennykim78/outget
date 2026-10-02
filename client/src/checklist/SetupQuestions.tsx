// L3 두 질문(스펙22 §3.4 · PRD US-004) — L2 안 스텝. 질문은 2개를 넘지 않는다.
//   ① 처음 키워요 / 이미 키우고 있어요(라디오 카드) ② 이미 가진 것(노출 요구사항 체크, › 없음).
//   꼬리: [건너뛰기] 텍스트 + [다음] 채움(①을 고르면 활성 — setup_started 의 firstTime 은 필수 bool).
import { useState } from 'react';
import { COPY } from '@ws/copy';
import { copyAt } from '../ui/copyText';
import { LayerFoot } from '../ui/layer/Layer';
import type { ChecklistRow } from './derive';
import type { SetupAnswer } from './setupStore';

export interface SetupQuestionsProps {
  rows: ChecklistRow[];
  initial: SetupAnswer | null;
  onNext(a: { firstTime: boolean; owned: string[] }): void;
  onSkip(): void;
}

export default function SetupQuestions({ rows, initial, onNext, onSkip }: SetupQuestionsProps) {
  const [firstTime, setFirstTime] = useState<boolean | null>(initial?.firstTime ?? null);
  const [owned, setOwned] = useState<Set<string>>(() => new Set(initial?.owned ?? []));
  const q1 = copyAt('setupQ.q1Title');
  const q2 = copyAt('setupQ.q2Title');

  const toggleOwned = (id: string) =>
    setOwned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const options: Array<[boolean, string]> = [
    [true, COPY.setupQ.firstTime],
    [false, COPY.setupQ.already],
  ];

  return (
    <>
      <div className="ws-layer-body ws-setupq" data-ws-step="L3">
        <fieldset className="ws-setupq-q" data-ws-q="1">
          {q1 ? <legend className="ws-t-section">{q1}</legend> : null}
          <div className="ws-setupq-radios">
            {options.map(([value, label]) => (
              <label key={String(value)} className={`ws-setupq-radio${firstTime === value ? ' ws-setupq-radio--on' : ''}`}>
                <input
                  type="radio"
                  name="ws-setupq-first"
                  className="ws-visually-hidden"
                  checked={firstTime === value}
                  onChange={() => setFirstTime(value)}
                />
                <span className="ws-t-cta">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="ws-setupq-q" data-ws-q="2">
          {/* 보이는 제목 = q2Title, 그룹 이름(legend) = "이미 가진 것"(시각적으로 숨김 — 중복 제목 없음, 설계 검수 F13). */}
          <legend className="ws-visually-hidden">{COPY.setupQ.owned}</legend>
          {q2 ? <h3 className="ws-t-section ws-setupq-title">{q2}</h3> : null}
          <ul className="ws-setupq-owned">
            {rows.map(({ requirement: r }) => (
              <li key={r.supplyItemId}>
                <label className="ws-setupq-item">
                  <input type="checkbox" checked={owned.has(r.supplyItemId)} onChange={() => toggleOwned(r.supplyItemId)} />
                  <span className="ws-t-body">{r.item.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
      <LayerFoot>
        <div className="ws-setupq-foot">
          <button type="button" className="ws-setupq-skip ws-t-cta" onClick={onSkip}>
            {COPY.setupQ.skip}
          </button>
          <button
            type="button"
            className="ws-btn ws-btn--fill"
            disabled={firstTime === null}
            onClick={() => {
              if (firstTime !== null) onNext({ firstTime, owned: rows.map((x) => x.requirement.supplyItemId).filter((id) => owned.has(id)) });
            }}
          >
            {COPY.setupQ.next}
          </button>
        </div>
      </LayerFoot>
    </>
  );
}
