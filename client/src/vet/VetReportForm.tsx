// 병원 제보(PRD US-013, 계약 C-R5-4, D15 · 오케스트레이터 K-6: 레이어가 아니라 /vet 하단 접힘 섹션).
//   입력 4개(병원명·주소·연락처·진료 동물) → POST /api/vets/reports → 접수 안내만. 제보 병원은 목록·지도·배지 어디에도 나타나지 않는다.
//   이메일·좌표·제보자 정보 입력 0. 채운 버튼 0(페이지의 채운 CTA 없음 원칙과 충돌하지 않게 아웃라인).
import { useId, useState, type FormEvent } from 'react';
import type { PublicAnimalType } from '@ws/engine';
import { copyAt } from '../ui/copyText';
import { validateVetReport, VET_REPORT_LIMITS, vetReportApi, type VetReportField } from './reportApi';

export interface VetReportFormProps {
  types: readonly PublicAnimalType[];
  /** 빈 상태 "제보하기" 링크로 열 때 true. */
  open: boolean;
  onToggle(open: boolean): void;
}

// invalid = 사전 검사 위반(필드 표시) · rejected = 서버 400(어느 필드인지 모름 — 안내 문구만).
type Phase = 'idle' | 'sending' | 'sent' | 'error' | 'invalid' | 'rejected';

export const VET_REPORT_SECTION_ID = 'ws-vet-report';

export default function VetReportForm({ types, open, onToggle }: VetReportFormProps) {
  const uid = useId();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [treats, setTreats] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [invalid, setInvalid] = useState<VetReportField[]>([]);

  const title = copyAt('vet.reportTitle');
  const submit = copyAt('vet.reportSubmit');
  if (!title || !submit) return null;

  const bad = (f: VetReportField) => invalid.includes(f);
  const invalidNote = copyAt('vet.reportInvalid');
  const noteId = `${uid}-note`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (phase === 'sending') return;
    const v = validateVetReport({ name, address, phone, treats });
    if (v.body === null) {
      setInvalid(v.invalid);
      setPhase('invalid');
      return;
    }
    setInvalid([]);
    setPhase('sending');
    const r = await vetReportApi.send(v.body);
    if (r === 'ok') {
      setName('');
      setAddress('');
      setPhone('');
      setTreats([]);
      setPhase('sent');
    } else if (r === 'invalid') {
      setPhase('rejected');
    } else {
      setPhase('error'); // 429·네트워크·5xx — 입력 유지.
    }
  }

  const field = (key: VetReportField, label: string | null, value: string, set: (s: string) => void, extra: Record<string, string | number>) =>
    label ? (
      <p className="ws-vet-report-field">
        <label htmlFor={`${uid}-${key}`}>{label}</label>
        <input
          id={`${uid}-${key}`}
          name={key}
          value={value}
          required
          aria-invalid={bad(key) ? 'true' : undefined}
          aria-describedby={bad(key) && invalidNote ? noteId : undefined}
          onChange={(e) => {
            set(e.target.value);
            if (phase === 'sent') setPhase('idle');
          }}
          {...extra}
        />
      </p>
    ) : null;

  const treatsLabel = copyAt('vet.reportTreats');

  return (
    <details
      id={VET_REPORT_SECTION_ID}
      className="ws-vet-report"
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{title}</summary>
      <form className="ws-vet-report-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {field('name', copyAt('vet.reportName'), name, setName, { maxLength: VET_REPORT_LIMITS.name, autoComplete: 'off' })}
        {field('address', copyAt('vet.reportAddress'), address, setAddress, {
          maxLength: VET_REPORT_LIMITS.address,
          autoComplete: 'off',
        })}
        {field('phone', copyAt('vet.reportPhone'), phone, setPhone, { type: 'tel', inputMode: 'tel', maxLength: 13, autoComplete: 'off' })}
        {treatsLabel && types.length > 0 ? (
          <fieldset className="ws-vet-report-treats" aria-invalid={bad('treats') ? 'true' : undefined}>
            <legend>{treatsLabel}</legend>
            {types.map((t) => (
              <label key={t.id} className="ws-vet-report-check">
                <input
                  type="checkbox"
                  name="treats"
                  value={t.id}
                  checked={treats.includes(t.id)}
                  onChange={(e) =>
                    setTreats((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))
                  }
                />
                {t.displayName}
              </label>
            ))}
          </fieldset>
        ) : null}
        {phase === 'invalid' && invalidNote ? (
          <p id={noteId} className="ws-vet-report-note ws-vet-report-note--fail" role="alert">
            {invalidNote}
          </p>
        ) : null}
        <p className="ws-vet-report-actions">
          <button type="submit" className="ws-btn ws-btn--outline" disabled={phase === 'sending'} aria-busy={phase === 'sending' ? 'true' : undefined}>
            {submit}
          </button>
        </p>
        <p className="ws-vet-report-status" role="status" aria-live="polite">
          {phase === 'sent'
            ? copyAt('vet.reportThanks')
            : phase === 'error'
              ? copyAt('vet.reportError')
              : phase === 'rejected'
                ? (invalidNote ?? copyAt('vet.reportError'))
                : null}
        </p>
      </form>
    </details>
  );
}
