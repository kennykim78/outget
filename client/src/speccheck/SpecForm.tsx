// SpecForm(스펙33 §4) — specSchema 가 폼을 정한다. 숫자·예/아니오·선택지만, 주소(URL)·이미지 입력 없음.
//   number: inputmode decimal · step any · min/max 표시용(범위 판정은 엔진 CHECK 만, D-44 — 폼은 noValidate).
//   boolean: 라디오 "예"/"아니오", 기본값 없음. enum ≤4 라디오 카드, ≥5 select. 라벨 불완전 enum 미렌더(formFields).
import { useId } from 'react';
import { COPY } from '@ws/copy';
import { optionLabel, splitLabel, type SpecField, type SpecSchema } from '@ws/engine';
import { formFields, showOptionalMark, type FormRules } from './verdictView';

export interface SpecFormProps {
  schema: SpecSchema;
  values: Readonly<Record<string, string>>;
  onChange(key: string, value: string): void;
  /** 카탈로그 로드 전·실패 — fieldset disabled. */
  disabled?: boolean;
  /** 숫자 칸 레이아웃(L6 은 3열). */
  numberColumns?: 1 | 2 | 3;
  /** 숫자 칸 오류(key → 안내 문구). 있으면 aria-invalid + fail 테두리 + 칸 아래 meta(aria-describedby). L6 범위 밖(DR m-2). */
  errors?: Readonly<Record<string, string>>;
  /** 해석된 minSpec·recommendedSpec(L5 = ws-data 요구사항). ruleScoped 필드 노출·'선택' 표시가 이것으로 정해진다(프리렌더와 같은 판정). */
  rules?: FormRules;
  /**
   * 286 U5a(L5 입력 상태): 숫자 칸 라벨은 이름만(「지름」), 단위(「cm」)는 칸 안 오른쪽 — aria-describedby 로 단위를 함께 읽는다.
   *   프리렌더 L5(server type.ts layerL5)와 같은 마크업 규칙. L6(케이지)은 기본(라벨에 단위 포함).
   */
  unitInside?: boolean;
}

const ENUM_RADIO_MAX = 4;
const NO_FORM_RULES: FormRules = {};

function LabelText({ field, rules, text }: { field: SpecField; rules: FormRules; text?: string }) {
  return (
    <>
      {text ?? field.label}
      {showOptionalMark(field, rules) ? <span className="ws-spec-optional">{` · ${COPY.checkLayer.optional}`}</span> : null}
    </>
  );
}

function RadioGroup({
  name,
  field,
  options,
  value,
  onChange,
  rules,
}: {
  name: string;
  field: SpecField;
  rules: FormRules;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange(v: string): void;
}) {
  return (
    <fieldset className="ws-spec-field ws-spec-field--choice" role="radiogroup" data-ws-field={field.key}>
      <legend className="ws-t-label ws-spec-label">
        <LabelText field={field} rules={rules} />
      </legend>
      <div className="ws-spec-radios">
        {options.map((o) => (
          <label key={o.value} className={`ws-spec-radio${value === o.value ? ' ws-spec-radio--on' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="ws-t-cta">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function SpecForm({
  schema,
  values,
  onChange,
  disabled = false,
  numberColumns = 2,
  errors,
  rules = NO_FORM_RULES,
  unitInside = false,
}: SpecFormProps) {
  const uid = useId();
  const fields = formFields(schema, rules);
  const numbers = fields.filter((f) => f.type === 'number');
  const others = fields.filter((f) => f.type !== 'number');

  return (
    <fieldset className="ws-spec-form" disabled={disabled} data-ws-spec-form="">
      {numbers.length > 0 ? (
        <div className={`ws-spec-numbers ws-spec-numbers--${numberColumns}`}>
          {numbers.map((f) => {
            if (f.type !== 'number') return null;
            const id = `${uid}-${f.key}`;
            const error = errors?.[f.key] ?? null;
            const errorId = `${id}-err`;
            const { base, unit } = splitLabel(f.label);
            const inner = unitInside && unit !== '';
            const unitId = `${id}-unit`;
            const describedBy = [inner ? unitId : null, error ? errorId : null].filter((x): x is string => x !== null).join(' ') || undefined;
            const input = (
              <input
                id={id}
                name={f.key}
                className={`ws-spec-input ws-t-spec${error ? ' ws-spec-input--invalid' : ''}`}
                type="number"
                inputMode="decimal"
                step="any"
                min={f.min}
                max={f.max}
                value={values[f.key] ?? ''}
                onChange={(e) => onChange(f.key, e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
              />
            );
            return (
              <div key={f.key} className="ws-spec-field" data-ws-field={f.key}>
                <label htmlFor={id} className="ws-t-label ws-spec-label">
                  <LabelText field={f} rules={rules} text={inner ? base : undefined} />
                </label>
                {inner ? (
                  <span className="ws-spec-inputwrap">
                    {input}
                    <span className="ws-spec-unit" id={unitId}>
                      {unit}
                    </span>
                  </span>
                ) : (
                  input
                )}
                {error ? (
                  <p id={errorId} className="ws-t-meta ws-spec-error">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {others.map((f) => {
        const name = `${uid}-${f.key}`;
        const value = values[f.key] ?? '';
        if (f.type === 'boolean') {
          return (
            <RadioGroup
              key={f.key}
              name={name}
              field={f}
              rules={rules}
              value={value}
              onChange={(v) => onChange(f.key, v)}
              options={[
                { value: 'true', label: COPY.verdict.yes },
                { value: 'false', label: COPY.verdict.no },
              ]}
            />
          );
        }
        if (f.type !== 'enum') return null;
        const options = f.options.map((o) => ({ value: o, label: optionLabel(f, o) ?? '' }));
        if (options.length <= ENUM_RADIO_MAX) {
          return <RadioGroup key={f.key} name={name} field={f} rules={rules} value={value} onChange={(v) => onChange(f.key, v)} options={options} />;
        }
        return (
          <div key={f.key} className="ws-spec-field" data-ws-field={f.key}>
            <label htmlFor={name} className="ws-t-label ws-spec-label">
              <LabelText field={f} rules={rules} />
            </label>
            <select id={name} name={f.key} className="ws-spec-input ws-t-body" value={value} onChange={(e) => onChange(f.key, e.target.value)}>
              <option value="" />
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </fieldset>
  );
}
