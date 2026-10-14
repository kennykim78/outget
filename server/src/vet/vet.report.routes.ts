// 병원 제보(PRD US-013, 계약 C-R5-4, 결정 D15) — 마운트는 BE1(app.ts, '/api/vets/reports', IP 5/시간 리미터).
//   POST / {name≤60, address≤120, phone(숫자·하이픈 9~13), treats: typeId[]≤6} → 202 {}(접수 안내만).
//   저장: VetClinic status REPORTED · source USER_REPORT · 좌표 null → 목록·상세·프리렌더 비노출(운영자 전화 확인 전).
//   제보자 식별 정보(IP·UA·이메일·세션) 0 — 본문의 병원 정보만 저장한다. 진료 가능 여부 판단 없음(불변식 ⑤).
import { randomUUID } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import type { VetReportRecord, VetReportRepository } from './vet.repo.js';

export const REPORT_LIMITS = { name: 60, address: 120, treats: 6 } as const;
const PHONE_RE = /^(?=(?:.*\d){9})[0-9-]{9,13}$/;
const PHONE_SHAPE_RE = /^\d[0-9-]*\d$/;
const TYPE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
// 제어 문자·꺾쇠·URL 체계 — 운영자 화면 주입·링크 스팸 방지.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f<>]|:\/\//;
const FIELDS = ['name', 'address', 'phone', 'treats'] as const;

export interface VetReportRouterOptions {
  /** 제보 리미터(마운트하는 쪽이 넘긴다). */
  limiter?: RequestHandler;
  /** 알려진(노출) 동물 id 집합 — 주면 treats 를 이 안으로 제한. */
  knownTypeIds?: ReadonlySet<string>;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (t.length === 0 || t.length > max || UNSAFE_TEXT_RE.test(t)) return null;
  return t;
}

export function parseVetReport(
  x: unknown,
  knownTypeIds?: ReadonlySet<string>,
): Omit<VetReportRecord, 'id' | 'region'> | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== FIELDS.length || !FIELDS.every((k) => keys.includes(k))) return null;
  const name = cleanText(o.name, REPORT_LIMITS.name);
  const address = cleanText(o.address, REPORT_LIMITS.address);
  if (name === null || address === null) return null;
  const phone = typeof o.phone === 'string' ? o.phone.trim() : '';
  if (!PHONE_RE.test(phone) || !PHONE_SHAPE_RE.test(phone) || phone.includes('--')) return null;
  if (!Array.isArray(o.treats) || o.treats.length > REPORT_LIMITS.treats) return null;
  if (!o.treats.every((t) => typeof t === 'string' && TYPE_ID_RE.test(t))) return null;
  const treats = [...new Set(o.treats as string[])];
  if (knownTypeIds && !treats.every((t) => knownTypeIds.has(t))) return null;
  return { name, address, phone, treats };
}

export function createVetReportRouter(repo: VetReportRepository, opts: VetReportRouterOptions = {}): Router {
  const router = Router();
  const json = express.json({ limit: '2kb' });
  const limit: RequestHandler = opts.limiter ?? ((_req, _res, next) => next());

  router.post('/', limit, json, async (req, res) => {
    if (req.is('application/json') !== 'application/json') {
      res.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    const parsed = parseVetReport(req.body, opts.knownTypeIds);
    if (!parsed) {
      res.status(400).json({ error: 'bad_report' });
      return;
    }
    try {
      // region 은 비워 둔다(제보 폼에 없음 — 운영자가 전화 확인 때 채운다). 좌표는 저장 경로 자체가 없다.
      await repo.createReport({ id: `vr-${randomUUID()}`, region: '', ...parsed });
      res.status(202).json({});
    } catch {
      res.status(500).json({ error: 'report_failed' });
    }
  });

  return router;
}
