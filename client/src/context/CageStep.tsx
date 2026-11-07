// L6 내 케이지 스텝(L5·L2 안 — 레이어 아님, C-R5-5 wsLayerProps.step='L6'). 스펙33 §4 CageForm · §5.3 · PRD US-010.
//   필드 = cage specSchema(형태 라디오 2×2 → 바닥 가로·세로·높이 3열 → 철망 간격(WIRE 만, D7) 1열). URL·이미지 입력 없음.
//   저장 = ws.context.{typeId}.cage 스키마 키만(cageStore.validateCage — 범위 밖이면 [저장] 비활성). "이 기기에만 저장돼요".
//   저장·지우기 후 onDone(이전 스텝). 마스코트 0.
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { COPY } from '@ws/copy';
import type { SpecSchema } from '@ws/engine';
import { wsStorage, type WsStorage } from '../lib/storage';
import { useSaveLinked } from '../save/useSaveLinked';
import SpecForm from '../speccheck/SpecForm';
import { LayerBody, LayerFoot, useLayerChrome } from '../ui/layer/Layer';
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

export default function CageStep({ typeId, schema, backLabel, onBack, storage = wsStorage }: CageStepProps) {
  const chrome = useLayerChrome();
  const { cage, save, remove } = useCage(typeId, { schema, storage });
  const [raw, setRaw] = useState<Record<string, string>>(() => toRaw(cage));
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

  return (
    <div className="ws-cage-step" data-ws-step="L6">
      <LayerBody>
        <form
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
