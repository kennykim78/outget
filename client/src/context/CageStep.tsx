// L6 내 케이지 스텝(L5·L2 안 — 레이어 아님, C-R5-5 wsLayerProps.step='L6'). 스펙33 §4 CageForm · §5.3 · PRD US-010.
//   필드 = cage specSchema(형태 라디오 2×2 → 바닥 가로·세로·높이 3열 → 철망 간격(WIRE 만, D7) 1열). URL·이미지 입력 없음.
//   저장 = ws.context.{typeId}.cage 스키마 키만(cageStore.validateCage — 범위 밖이면 [저장] 비활성). "이 기기에만 저장돼요".
//   저장·지우기 후 onDone(이전 스텝). 마스코트 0.
//   R4-5(R4 시안 l6_my_cage): 케이지가 이미 있으면 첫 화면 = 「등록한 케이지」 보기(저장값 큰 숫자 → ① 자체 최소 규격 → ② 용품 간 호환)
//     + 채운 버튼 하나 「등록값 수정하기」 → 위 폼. 판정은 cageReview(엔진 specCheck·requirementCompat)만, 숫자는 저장값·해석된 minSpec 만.
//     시안의 「검수 대기」 줄은 그리지 않는다(VERIFIED 만 노출 — 불변식 ⑦).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COPY } from '@ws/copy';
import { findField, optionLabel, splitLabel, type Engine, type PublicRequirement, type SpecSchema } from '@ws/engine';
import { wsStorage, type WsStorage } from '../lib/storage';
import { useSaveLinked } from '../save/useSaveLinked';
import { loadEngine } from '../speccheck/engine';
import SpecForm from '../speccheck/SpecForm';
import Glyph from '../ui/Glyph';
import { LayerBody, LayerFoot, useLayerChrome } from '../ui/layer/Layer';
import { cageReview, type CageReview } from './cageReview';
import { CAGE_TYPES, useCage, validateCage, type CageV1 } from './cageStore';
import '../styles/speccheck.css';

export interface CageStepProps {
  typeId: string;
  /** cage specSchema(ws-data 또는 카탈로그). null 이면 저장 불가(폼 비활성). */
  schema: SpecSchema | null;
  /** 뒤로 버튼 이름(이전 스텝명 — "규격 확인"·"지금 필요한 것"). */
  backLabel: string;
  /** 이전 스텝으로(뒤로·저장·지우기 후). */
  onBack(): void;
  /** 테스트 주입(기본 = 앱 전역 wsStorage). */
  storage?: WsStorage;
  /** R4-5 등록한 케이지 보기 — 동물 표시명(시드). 없으면 부제에서 생략. */
  animalName?: string;
  /** 이 문서 ws-data 요구사항(이 타입). 없으면 판정 줄 없음(숫자만). */
  reqs?: readonly PublicRequirement[];
  /** 공개 카탈로그(동일 출처) — 엔진 로드. 없거나 실패하면 판정 줄 없음. */
  catalogUrl?: string;
}

/** 테스트 주입(기본 = 동일 출처 카탈로그 엔진). */
export const cageStepDeps = {
  load: (catalogUrl: string): Promise<Engine> => loadEngine(catalogUrl),
};

function useReview(typeId: string, cage: CageV1 | null, reqs: readonly PublicRequirement[] | undefined, catalogUrl: string | undefined, animalName: string): CageReview | null {
  const [engine, setEngine] = useState<Engine | null>(null);
  const need = cage !== null && !!catalogUrl && !!reqs && reqs.length > 0;
  useEffect(() => {
    if (!need || !catalogUrl) return;
    let live = true;
    cageStepDeps.load(catalogUrl).then(
      (e) => {
        if (live) setEngine(e);
      },
      () => undefined, // 실패 → 판정 줄 없음(저장값 숫자만)
    );
    return () => {
      live = false;
    };
  }, [need, catalogUrl]);
  return useMemo(() => (engine && cage && reqs ? cageReview(engine, typeId, reqs, cage, animalName) : null), [engine, cage, reqs, typeId, animalName]);
}

function CageSummary({ cage, schema, animalName, review }: { cage: CageV1; schema: SpecSchema | null; animalName: string; review: CageReview | null }) {
  const field = (key: string) => (schema ? findField(schema, key) : undefined);
  const unit = splitLabel(field('floorWcm')?.label ?? '').unit;
  const height = splitLabel(field('heightCm')?.label ?? '');
  const typeLabel = schema ? optionLabel(field('type'), cage.type) : null;
  const sub = [animalName, typeLabel].filter((x): x is string => !!x).join(' · ');
  const self = review?.self ?? null;
  return (
    <section className="ws-cage-summary" data-ws-cage="summary" aria-labelledby="ws-cage-summary-title">
      <div className="ws-cage-summary-top">
        <h3 id="ws-cage-summary-title" className="ws-cage-summary-title">
          {COPY.cage.registeredTitle}
        </h3>
        {sub ? <p className="ws-t-meta ws-spec-muted">{sub}</p> : null}
        <p className="ws-t-label ws-cage-summary-label">{COPY.cage.floorLabel}</p>
        <p className="ws-verdict-num ws-verdict-num--min" data-ws-cage-part="floor">
          <span className="ws-verdict-num-value">{`${cage.floorWcm}×${cage.floorDcm}`}</span>
          {unit ? <span className="ws-verdict-num-unit">{unit}</span> : null}
        </p>
        <p className="ws-t-body" data-ws-cage-part="height">{`${height.base || ''} ${cage.heightCm}${height.unit}`.trim()}</p>
      </div>
      {self ? (
        <div className={`ws-verdict-line ws-verdict-line--${self.mark.tone}`} data-ws-cage-part="self" data-ws-tone={self.mark.tone}>
          <h4 className="ws-verdict-line-mark ws-cage-summary-mark" data-ws-mark={self.mark.kind}>
            <Glyph kind={self.mark.kind} className="ws-verdict-glyph" />
            <span>{self.title}</span>
          </h4>
          {self.minText ? <p className="ws-t-body ws-cage-summary-muted">{self.minText}</p> : null}
          {self.messages.map((m) => (
            <p key={m} className="ws-t-body">
              {m}
            </p>
          ))}
          <p className="ws-t-meta ws-cage-summary-muted">{COPY.cage.selfNote}</p>
        </div>
      ) : null}
      {(review?.compat ?? []).map((c) => (
        <div
          key={c.supplyItemId}
          className={`ws-verdict-line ws-verdict-line--${c.mark.tone}`}
          data-ws-cage-part="compat"
          data-ws-tone={c.mark.tone}
          data-ws-item={c.supplyItemId}
        >
          <h4 className="ws-verdict-line-mark ws-cage-summary-mark" data-ws-mark={c.mark.kind}>
            <Glyph kind={c.mark.kind} className="ws-verdict-glyph" />
            <span>{c.title}</span>
          </h4>
          {c.messages.map((m) => (
            <p key={m} className="ws-t-body">
              {m}
            </p>
          ))}
          <p className="ws-t-meta ws-cage-summary-muted">
            {c.usedRecommended ? COPY.supplyLayer.compatSubNoteRecommended : COPY.supplyLayer.compatSubNote}
          </p>
        </div>
      ))}
    </section>
  );
}

const NUMBER_KEYS = ['floorWcm', 'floorDcm', 'heightCm'] as const;
const GAP_KEY = 'barGapMm';
const TYPE_KEY = 'type';

function toRaw(c: CageV1 | null): Record<string, string> {
  if (!c) return {};
  const out: Record<string, string> = {
    type: c.type,
    floorWcm: String(c.floorWcm),
    floorDcm: String(c.floorDcm),
    heightCm: String(c.heightCm),
  };
  if (c.barGapMm !== undefined) out.barGapMm = String(c.barGapMm);
  return out;
}

function toInput(raw: Readonly<Record<string, string>>): Record<string, unknown> {
  const num = (s: string | undefined): number | undefined => {
    const t = (s ?? '').trim();
    if (t === '') return undefined;
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const out: Record<string, unknown> = { type: raw.type };
  for (const k of NUMBER_KEYS) out[k] = num(raw[k]);
  const gap = num(raw[GAP_KEY]);
  if (raw.type === 'WIRE' && gap !== undefined) out[GAP_KEY] = gap;
  return out;
}

/**
 * 범위 밖 숫자 칸(DR m-2): 값이 있는데 숫자가 아니거나 스키마 min/max 밖이면 cage.outOfRange. 빈 칸은 오류 아님(그냥 [저장] 비활성).
 *   철망 간격은 WIRE 일 때만 본다(D7 — 다른 형태면 칸이 없다).
 */
export function rangeErrors(schema: SpecSchema | null, raw: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!schema) return out;
  const keys: string[] = [...NUMBER_KEYS, ...(raw.type === 'WIRE' ? [GAP_KEY] : [])];
  for (const k of keys) {
    const f = schema.fields.find((x) => x.key === k);
    const t = (raw[k] ?? '').trim();
    if (!f || f.type !== 'number' || t === '') continue;
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n) || n < f.min || n > f.max) out[k] = COPY.cage.outOfRange;
  }
  return out;
}

/** type 옵션 = schema.options ∩ CAGE_TYPES(L6 저장 계약 밖 값은 노출 안 함 — 저장이 조용히 실패하는 것 방지). */
function pickSchema(schema: SpecSchema, keys: readonly string[]): SpecSchema {
  return {
    fields: keys
      .flatMap((k) => schema.fields.filter((f) => f.key === k))
      .map((f) =>
        f.key === TYPE_KEY && f.type === 'enum'
          ? { ...f, options: f.options.filter((o) => (CAGE_TYPES as readonly string[]).includes(o)) }
          : f,
      ),
  };
}

export default function CageStep({ typeId, schema, backLabel, onBack, storage = wsStorage, animalName = '', reqs, catalogUrl }: CageStepProps) {
  const chrome = useLayerChrome();
  const { cage, save, remove } = useCage(typeId, { schema, storage });
  const [raw, setRaw] = useState<Record<string, string>>(() => toRaw(cage));
  // R4-5: 케이지가 있으면 보기부터. 「등록값 수정하기」 → 폼(이 스텝 안 — 새 레이어·히스토리 0).
  const [editing, setEditing] = useState(false);
  const review = useReview(typeId, cage, reqs, catalogUrl, animalName);
  const formRef = useRef<HTMLFormElement | null>(null);
  const focusForm = useRef(false);
  useEffect(() => {
    if (!editing || !focusForm.current) return;
    focusForm.current = false;
    // 누른 버튼이 사라지므로 첫 입력으로 포커스를 옮긴다.
    formRef.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, [editing]);
  // 이메일로 저장 중이면 "이 기기에만 저장돼요"는 사실이 아니므로 숨긴다(F2-3).
  const linked = useSaveLinked();
  // 저장소 쓰기 실패(메모리 대체) — "이 기기에만 저장돼요"가 아니라 저장 불가 안내, 저장·지우기 뒤 이전 화면으로 돌아가지 않고 안내를 보인다.
  const [unavailable, setUnavailable] = useState(() => storage.isMemoryOnly());
  useEffect(() => storage.onUnavailable(() => setUnavailable(true)), [storage]);

  useLayoutEffect(() => {
    chrome.setTitle(COPY.cage.title);
    chrome.setBack({ label: backLabel, onBack });
  }, [chrome, backLabel, onBack]);

  const parts = useMemo(
    () =>
      schema
        ? {
            type: pickSchema(schema, [TYPE_KEY]),
            dims: pickSchema(schema, NUMBER_KEYS),
            gap: pickSchema(schema, [GAP_KEY]),
          }
        : null,
    [schema],
  );
  const parsed = schema !== null ? validateCage(toInput(raw), schema) : null;
  const errors = useMemo(() => rangeErrors(schema, raw), [schema, raw]);
  const valid = parsed !== null;
  const onChange = (key: string, value: string) => setRaw((r) => ({ ...r, [key]: value }));

  const onSave = () => {
    if (parsed === null || !save(parsed)) return;
    if (storage.isMemoryOnly()) setUnavailable(true);
    else onBack();
  };
  const onDelete = () => {
    remove();
    if (storage.isMemoryOnly()) setUnavailable(true);
    else onBack();
  };

  if (cage && !editing && !unavailable) {
    return (
      <div className="ws-cage-step" data-ws-step="L6">
        <LayerBody>
          <CageSummary cage={cage} schema={schema} animalName={animalName} review={review} />
        </LayerBody>
        <LayerFoot>
          <div className="ws-cage-foot">
            <button
              type="button"
              className="ws-btn ws-btn--fill ws-cage-edit"
              onClick={() => {
                setRaw(toRaw(cage));
                focusForm.current = true;
                setEditing(true);
              }}
            >
              {COPY.cage.editCta}
            </button>
          </div>
        </LayerFoot>
      </div>
    );
  }

  return (
    <div className="ws-cage-step" data-ws-step="L6">
      <LayerBody>
        <form
          ref={formRef}
          className="ws-cage-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          {parts ? (
            <fieldset className="ws-cage-fields" data-ws-cage-fields="">
              <legend className="ws-visually-hidden">{COPY.cage.title}</legend>
              <SpecForm schema={parts.type} values={raw} onChange={onChange} />
              <SpecForm schema={parts.dims} values={raw} onChange={onChange} numberColumns={3} errors={errors} />
              {raw.type === 'WIRE' ? <SpecForm schema={parts.gap} values={raw} onChange={onChange} numberColumns={1} errors={errors} /> : null}
            </fieldset>
          ) : null}
        </form>
      </LayerBody>
      <LayerFoot>
        <div className="ws-cage-foot">
          <button type="button" className="ws-btn ws-btn--fill ws-cage-save" disabled={!valid} onClick={onSave}>
            {COPY.cage.save}
          </button>
          {cage ? (
            <button type="button" className="ws-spec-link ws-t-meta" onClick={onDelete}>
              {COPY.cage.delete}
            </button>
          ) : null}
          {unavailable ? (
            <p className="ws-t-meta ws-spec-muted" role="status" data-ws-note="storage-unavailable">
              {COPY.checklist.storageUnavailable}
            </p>
          ) : linked ? null : (
            <p className="ws-t-meta ws-spec-muted" data-ws-note="device-only">
              {COPY.cage.deviceOnly}
            </p>
          )}
        </div>
      </LayerFoot>
    </div>
  );
}
