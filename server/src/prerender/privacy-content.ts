// /privacy 본문 데이터(계획 86 P8·P10, Kenny K-1~K-4 2026-10-25). 렌더는 pages/misc.ts renderPrivacy.
//   법정 기재 항목 대조(원문, 국가법령정보센터 — 2026-10-25 열람, 현행 시행 2026-09-11):
//     개인정보 보호법 제30조제1항 각 호        https://www.law.go.kr/법령/개인정보보호법/제30조
//     같은 법 제28조의8제2항 각 호(국외 이전)   https://www.law.go.kr/법령/개인정보보호법/제28조의8
//     같은 법 제31조의2제4항(국내대리인)       https://www.law.go.kr/법령/개인정보보호법/제31조의2
//     같은 법 시행령 제31조제1항 각 호          https://www.law.go.kr/법령/개인정보보호법시행령/제31조
//   여기에는 "무엇을 하는지" 사실만 적는다. 법적 판단(적법성·충분성)은 쓰지 않는다 — 전문가 확인 대상(계획 86 K-1~K-4).
//   표기 규칙: 해요체, 금지어(seed/banned-words.json) 0 — 테스트 prerender.privacy.test.ts 가 lintText 로 강제.
//   쿠키 속성 이름(Http-Only·Max-Age·Same-Site 원문 표기)은 문자열에 쓰지 않는다 — compliance C9-COOKIE(직렬화 허용 파일 밖) 대상.
//
//   본문 토큰(렌더 시 치환, HTML 이스케이프 뒤에 치환하므로 토큰 문자는 [A-Za-z0-9_:{}] 만):
//     {policy:NAME}  → <span data-ws-policy="NAME">값</span> — NAME 은 privacy/policy.ts export(단일 출처).
//                      compliance C9-PRIVACY 가 산출물 값 = policy.ts 값을 대조한다.
//     {const:NAME}   → 다른 코드 상수에서 계산한 숫자(SESSION_DAYS 등, 아래 DERIVED). 그대로 숫자 텍스트.
//     {{KENNY:키}}   → Kenny 미정 값 자리표시. 그대로 출력되고, production 산출물이면 compliance C9-PRIVACY FAIL.
import {
  BACKUP_RETENTION_DAYS,
  EVENT_LOG_RETENTION_DAYS,
  REACTION_RETENTION_DAYS,
  RETENTION_INTERVAL_MS,
  SERVER_LOG_RETENTION_DAYS,
  TOMBSTONE_RETENTION_DAYS,
  UNUSED_USER_RETENTION_DAYS,
  VET_REPORT_RETENTION_DAYS,
} from '../privacy/policy.js';
import { SESSION_MAX_AGE_S } from '../save/cookie.js';
import { MAGIC_TTL_MS } from '../save/magic.routes.js';

/** 본문에 {policy:NAME} 으로 싣는 privacy/policy.ts 기간 상수(이름 = export 이름 그대로). */
export const POLICY_PERIODS = Object.freeze({
  UNUSED_USER_RETENTION_DAYS,
  EVENT_LOG_RETENTION_DAYS,
  REACTION_RETENTION_DAYS,
  VET_REPORT_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
  TOMBSTONE_RETENTION_DAYS,
  SERVER_LOG_RETENTION_DAYS,
});
export type PolicyPeriodName = keyof typeof POLICY_PERIODS;

/** 처리방침 변경 고지 — 시행 7일 전(Kenny K-4). */
export const CHANGE_NOTICE_DAYS = 7;

/** {const:NAME} — 코드 상수에서 계산한 값(문자열 숫자). */
export const DERIVED = Object.freeze({
  SESSION_DAYS: SESSION_MAX_AGE_S / 86_400,
  MAGIC_LINK_MINUTES: MAGIC_TTL_MS / 60_000,
  CLEANUP_INTERVAL_HOURS: RETENTION_INTERVAL_MS / 3_600_000,
  CHANGE_NOTICE_DAYS,
});
export type DerivedName = keyof typeof DERIVED;

/** Kenny 미정 값 자리표시 키(K-2·K-3·K-4). 본문 {{KENNY:키}} 는 이 목록 안에서만. */
export const KENNY_PLACEHOLDERS = Object.freeze([
  'officerName', // K-2 개인정보 보호책임자 실명
  'officerEmail', // K-2 전용 메일
  // K-3 호스팅 사업자·서버 위치·접속 기록은 Kenny 2026-10-27 확정(Oracle Cloud, 일본 도쿄, 웹 접속 기록 없음) — 본문에 직접 쓴다.
  'hostingContact', // K-3 Oracle 이전받는 자 연락처(제28조의8제2항제3호) — 2026-10-27 신설
  'resendContact', // K-3 이전받는 자 연락처(제28조의8제2항제3호)
  'resendLogRetention', // K-3 Resend 발송 기록 보관 기간(대시보드 확인)
  'effectiveDate', // K-4 시행일 = 공개 배포일
] as const);
export type KennyPlaceholder = (typeof KENNY_PLACEHOLDERS)[number];

/** 본문 링크는 내부 경로만(외부 링크 0, 96 N2). '//'·스킴 금지는 assertInternalHref 가 렌더에서 다시 검사. */
export type InternalHref = `/${string}`;

/** 표 셀: 글자 또는 본문 + 둘째 줄 보조(span.ws-t-meta.ws-privacy-meta, 96 S2 — 열을 늘리지 않고 같은 셀에 쌓는다). */
export type PrivacyCell = string | { readonly text: string; readonly meta: string };

export type PrivacyBlock =
  | { readonly p: string; readonly link?: { readonly href: InternalHref; readonly text: string } }
  | { readonly ul: readonly string[] }
  | { readonly table: { readonly caption: string; readonly head: readonly string[]; readonly rows: readonly (readonly PrivacyCell[])[] } };

export interface PrivacySection {
  /** 앵커 id(#privacy-{id}). */
  readonly id: string;
  readonly title: string;
  /** 대응 법정 기재 항목(주석·검사용, 화면에는 싣지 않는다). */
  readonly legal: string;
  /** "해당 없음" 항목. */
  readonly notApplicable?: true;
  readonly blocks: readonly PrivacyBlock[];
}

export interface PrivacyVersion {
  readonly version: string;
  readonly effectiveDate: string;
}

export interface PrivacyPolicy {
  readonly version: string;
  readonly effectiveDate: string;
  /** 이전 버전(최신 → 과거). 첫 버전이면 빈 배열. */
  readonly previousVersions: readonly PrivacyVersion[];
  readonly intro: readonly string[];
  readonly sections: readonly PrivacySection[];
}

export const PRIVACY_POLICY: PrivacyPolicy = {
  version: '1.0',
  effectiveDate: '{{KENNY:effectiveDate}}',
  previousVersions: [],
  intro: [
    '위드스몰(WithSmall)이 어떤 개인정보를 왜 받고, 얼마나 보관하고, 어떻게 지우는지 적었어요.',
    '위드스몰은 이메일 없이도 쓸 수 있어요. 이메일은 준비 내용을 다른 기기에서도 이어 보고 싶을 때만 받아요.',
  ],
  sections: [
    {
      id: 'purpose',
      title: '개인정보를 쓰는 목적',
      legal: '법 제30조제1항제1호',
      blocks: [
        {
          ul: [
            '이메일 저장: 이 기기에 저장한 준비 내용을 이메일과 연결해 다른 기기에서도 이어 볼 수 있게 해요.',
            '저장 연결 링크: 입력한 이메일 주소로 한 번만 쓰는 연결 링크를 보내요.',
            '이용 통계: 어떤 화면과 기능이 쓰이는지 개인을 알아볼 수 없는 형태로 세어 서비스를 고쳐요.',
            '반응 집계: 같은 사람이 같은 반응을 하루에 여러 번 남기지 않도록 해요.',
            '남용 방지: 짧은 시간에 요청이 너무 많이 오면 잠시 막아요.',
          ],
        },
        { p: '이 목적 밖으로 쓰지 않고, 광고나 소식 메일을 보내지 않아요.' },
      ],
    },
    {
      id: 'items',
      title: '받는 개인정보 항목',
      legal: '시행령 제31조제1항제1호',
      blocks: [
        {
          table: {
            caption: '받는 개인정보 항목',
            head: ['구분', '항목'],
            // 96 S2: '받는 때' 열 → 항목 셀 둘째 줄 '받는 때: …'(문구 이동만, 단어 변경 0).
            rows: [
              ['이메일 저장', { text: '이메일 주소, 저장한 준비 내용(고른 친구, 케이지 크기, 준비 체크 상태)', meta: '받는 때: 이메일 저장을 요청하고 연결 링크를 열 때' }],
              ['마지막 사용 날짜', { text: '마지막 사용 날짜(이메일 저장을 쓴 날). 오래 쓰지 않은 계정인지 가리는 데만 쓰고, 계정과 함께 보관해요.', meta: '받는 때: 이메일 저장을 쓸 때' }],
              ['연결 유지', { text: '세션 값(무작위 값, 서버에는 해시만 저장)', meta: '받는 때: 연결 링크를 열 때' }],
              ['연결 링크', { text: '이메일 주소, 한 번만 쓰는 토큰(서버에는 해시만 저장)', meta: '받는 때: 연결 링크를 요청할 때' }],
              ['이용 통계', { text: '화면·기능 이름, 고른 친구 종류, 이 기기의 무작위 값, 받은 날짜, 기기에서 보낸 시각, 찾지 못한 동물 이름으로 입력한 검색어', meta: '받는 때: 화면과 기능을 쓸 때' }],
              ['반응 집계', { text: '반응 종류와 대상, 날짜와 IP 주소 앞부분으로 만든 원래 주소를 그대로 남기지 않는 값', meta: '받는 때: 반응을 남길 때' }],
              ['남용 방지', { text: 'IP 주소(서버 메모리에서만 쓰고 저장하지 않아요)', meta: '받는 때: 요청할 때' }],
              ['서버 오류 기록', { text: '오류가 난 시각과 내용. 메일 보내기에 실패하면 앞 글자만 남기고 가린 이메일 주소가 함께 남아요. IP 주소와 요청 주소는 남기지 않아요.', meta: '받는 때: 서버에 오류가 날 때' }],
            ],
          },
        },
        { p: '접속한 IP 주소가 담긴 웹 접속 기록은 남기지 않아요.' },
        { p: '이름, 전화번호, 집 주소, 실시간 위치는 받지 않아요.' },
        { p: '검색어에 이메일이나 전화번호 형식이 있으면 받지 않아요. 검색어에 이름 같은 개인정보는 넣지 말아 주세요.' },
        { p: '병원 제보에는 병원 이름·주소·전화번호·진료 동물만 받아요. 제보한 사람의 정보는 받지 않아요.' },
      ],
    },
    {
      id: 'retention',
      title: '보유 기간',
      legal: '법 제30조제1항제2호',
      blocks: [
        {
          table: {
            caption: '항목별 보유 기간',
            head: ['항목', '보유 기간'],
            rows: [
              ['이메일 주소, 저장한 준비 내용', '직접 지울 때까지 보관해요. 마지막으로 쓴 날부터 {policy:UNUSED_USER_RETENTION_DAYS}일 동안 쓰지 않으면 자동으로 지워요.'],
              ['세션 값', '{const:SESSION_DAYS}일 뒤 만료돼요. 만료되거나 연결을 끊으면 지워요.'],
              ['연결 링크 토큰', '{const:MAGIC_LINK_MINUTES}분 뒤 만료되고 한 번 쓰면 끝나요. 만료되거나 쓰인 토큰은 지워요.'],
              ['이용 통계', '{policy:EVENT_LOG_RETENTION_DAYS}일 동안 보관해요.'],
              ['반응 집계', '{policy:REACTION_RETENTION_DAYS}일 동안 보관해요.'],
              // 264(Kenny ORDERS §41): privacy/retention.ts 가 접수 후 180일 지난 VERIFIED 외 사용자 제보를 지운다 — 확인(VERIFIED)된 병원은 목록 데이터로 남는다.
              ['동물병원 제보(병원 이름·주소·전화번호)', '받은 날부터 {policy:VET_REPORT_RETENTION_DAYS}일 동안 보관해요. 전화로 확인해 병원 목록에 올린 병원은 목록 정보로 남아요.'],
              ['서버 백업', '{policy:BACKUP_RETENTION_DAYS}일이 지난 백업 파일은 정기 정리 때 지워요.'],
              ['삭제 기록', '지운 뒤 {policy:TOMBSTONE_RETENTION_DAYS}일 보관하고, 백업에서 복원한 계정을 다시 지운 경우에는 그날부터 같은 기간을 다시 보관해요. 지운 이메일 주소가 백업에서 되살아나지 않게, 원래 주소를 그대로 남기지 않는 값(해시)으로만 남겨요.'],
              ['남용 방지용 IP 주소', '저장하지 않아요. 서버 메모리에서 짧은 시간 동안만 세요.'],
              ['웹 접속 기록', '남기지 않아요.'],
              ['서버 오류 기록', '{policy:SERVER_LOG_RETENTION_DAYS}일이 지나면 자동으로 지워요.'],
              // security 150 MED-B: deploy/bootstrap.sh ADMIN_LOG_DAYS=366(logrotate daily·rotate·maxage) 와 같아야 한다(deploy-config.test.mjs 패리티).
              ['운영자 접속 기록', '서버에 들어온 운영자의 기록이에요. 1년 동안 보관하고, 1년이 지나면 자동으로 지워요.'],
            ],
          },
        },
        { p: '이 기기에만 저장한 내용은 서버에 없어요. 브라우저의 사이트 데이터를 지우면 사라져요.' },
      ],
    },
    {
      id: 'destruction',
      title: '파기 절차와 방법',
      legal: '법 제30조제1항제3호의2',
      blocks: [
        { p: '보유 기간이 끝나거나 지워 달라는 요청을 받으면 그 정보를 데이터베이스에서 지워요.' },
        { p: '정리 작업은 서버가 켜질 때와 그 뒤 {const:CLEANUP_INTERVAL_HOURS}시간마다 돌아요. 지운 뒤에는 데이터베이스 파일을 다시 정리해 지운 내용이 파일에 남지 않게 해요.' },
        { p: '백업에 남은 정보는 백업 파일째 지워요. 그 전에 백업을 되살리더라도 삭제 기록을 보고 지운 이메일 주소를 다시 지워요.' },
        { p: '종이로 받는 개인정보는 없어요. 다른 법령에 따라 따로 보존하는 개인정보도 없어요.' },
      ],
    },
    {
      id: 'third-party',
      title: '제3자 제공',
      legal: '법 제30조제1항제3호',
      notApplicable: true,
      blocks: [{ p: '개인정보를 제3자에게 제공하지 않아요.' }],
    },
    {
      id: 'outsourcing',
      title: '처리 위탁',
      legal: '법 제30조제1항제4호',
      blocks: [
        {
          table: {
            caption: '처리를 맡기는 곳',
            head: ['맡기는 곳', '맡기는 일'],
            rows: [
              ['Resend, Inc.', '저장 연결 링크 메일 보내기'],
              ['Oracle Corporation(Oracle Cloud Infrastructure)', '서버와 데이터베이스 운영(호스팅)'],
            ],
          },
        },
      ],
    },
    {
      id: 'overseas',
      title: '국외 이전',
      legal: '시행령 제31조제1항제2호 · 법 제28조의8제2항',
      blocks: [
        { p: '개인정보는 아래 두 곳으로 국외 이전돼요. 처리를 맡기는 데 필요한 이전이라 아래 내용을 이 처리방침에 공개해요.' },
        { p: '저장 연결 링크 메일을 보내려고 이메일 주소를 미국의 메일 발송 서비스로 보내요.' },
        {
          ul: [
            '이전 근거: 개인정보 보호법 제28조의8제1항제3호(계약 이행에 필요한 처리위탁, 처리방침 공개)',
            '이전하는 항목: 이메일 주소, 연결 링크가 담긴 메일 내용',
            '이전하는 국가: 미국',
            '이전 시기와 방법: 연결 링크를 요청할 때마다 암호화된 통신(HTTPS)으로 보내요.',
            '이전받는 곳: Resend, Inc.(연락처 {{KENNY:resendContact}})',
            '이전받는 곳의 이용 목적과 보유 기간: 메일 발송, 발송 기록은 {{KENNY:resendLogRetention}} 동안 보관',
            '거부 방법과 효과: 이메일 저장을 쓰지 않으면 이전되지 않아요. 이때 준비 내용은 이 기기에만 저장돼요.',
          ],
        },
        // Kenny 2026-10-27: 호스팅 Oracle Cloud(ap-tokyo-1). 서버에 저장·처리하는 개인정보 전부가 일본 서버에 있다.
        { p: '서비스 서버와 데이터베이스를 일본 도쿄에 있는 클라우드 서버에서 운영해요. 그래서 서버가 받는 개인정보는 모두 일본으로 이전돼요.' },
        {
          ul: [
            '이전 근거: 개인정보 보호법 제28조의8제1항제3호(계약 이행에 필요한 처리위탁, 처리방침 공개)',
            "이전하는 항목: 서버가 받는 개인정보 전부('받는 개인정보 항목' 표의 항목)",
            '이전하는 국가: 일본(도쿄)',
            '이전 시기와 방법: 사이트를 쓰는 동안 요청할 때마다 암호화된 통신(HTTPS)으로 서버에 보내 저장해요.',
            '이전받는 곳: Oracle Corporation(Oracle Cloud Infrastructure, 연락처 {{KENNY:hostingContact}})',
            "이전받는 곳의 이용 목적과 보유 기간: 서버와 데이터베이스 운영(호스팅), 보유 기간은 '보유 기간' 표와 같아요.",
            '거부 방법과 효과: 이메일 저장과 반응을 쓰지 않으면 그 정보는 이전되지 않아요. 사이트를 쓰면 이용 통계와 남용 방지에 쓰는 정보는 서버로 보내져요.',
          ],
        },
        { p: '서버 위치: 일본(도쿄)' },
      ],
    },
    {
      id: 'sensitive',
      title: '민감정보',
      legal: '법 제30조제1항제3호의3',
      notApplicable: true,
      blocks: [{ p: '민감정보를 받지 않아요.' }],
    },
    {
      id: 'pseudonym',
      title: '가명정보',
      legal: '법 제30조제1항제4호의2',
      notApplicable: true,
      blocks: [{ p: '별도의 가명정보 처리는 하지 않아요. 지운 계정을 확인하는 해시는 위 보유 기간의 삭제 기록에 적었어요.' }],
    },
    {
      id: 'rights',
      title: '이용자의 권리와 행사 방법',
      legal: '법 제30조제1항제5호',
      blocks: [
        { p: '이용자는 언제든 자신의 개인정보를 열람하고, 고치거나 지우고, 처리를 멈춰 달라고 요청할 수 있어요.' },
        { p: '요청은 개인정보 보호책임자 메일({{KENNY:officerEmail}})로 보내 주세요. 본인인지 알 수 있게 저장에 쓴 이메일 주소에서 보내 주세요. 법정대리인이나 위임받은 사람도 요청할 수 있어요.' },
        {
          p: '이메일 저장 화면에서 지우기를 고르면 이메일 주소와 저장한 준비 내용을 바로 지워요.',
          link: { href: '/save', text: '이메일 저장 화면 열기' }, // 96 N2
        },
        { p: '위드스몰은 만 14세 미만 아동을 위한 서비스가 아니에요. 만 14세 미만이라면 이메일 저장을 쓰지 말고 이 기기에만 저장해 주세요. 만 14세 미만의 이메일 주소가 저장된 것을 알게 되면 지워요.' },
      ],
    },
    {
      id: 'auto-collect',
      title: '자동으로 수집하는 장치',
      legal: '법 제30조제1항제7호',
      blocks: [
        {
          ul: [
            '연결 유지 쿠키(ws_sid): 이메일 연결을 한 경우에만 만들어요. 무작위 값이고 페이지 스크립트가 읽을 수 없게 설정해요. {const:SESSION_DAYS}일 뒤 만료돼요.',
            '브라우저 저장소(ws.로 시작하는 항목): 고른 친구, 케이지 크기, 준비 체크, 남긴 반응, 이용 통계용 무작위 값을 이 기기에 저장해요.',
          ],
        },
        { p: '광고용 쿠키나 외부 분석 도구는 쓰지 않아요.' },
        { p: '브라우저 설정에서 쿠키와 사이트 데이터를 막거나 지울 수 있어요. 막으면 이메일 연결이 유지되지 않고, 준비 내용이 이 기기에 남지 않을 수 있어요.' },
        { p: '병원 페이지의 지도는 네이버 지도를 불러와요. 이때 브라우저가 네이버 서버에 직접 접속하고, 네이버의 개인정보 처리방침이 적용돼요. 위드스몰은 위치를 저장하지 않아요.' },
      ],
    },
    {
      id: 'protection',
      title: '개인정보 보호 조치',
      legal: '시행령 제31조제1항제3호',
      blocks: [
        {
          ul: [
            '연결 링크 토큰과 세션 값은 원래 값 대신 해시로만 저장해요.',
            '사이트와 서버 사이의 통신은 HTTPS로 암호화해요.',
            '반응 집계용 값은 원래 값을 알아볼 수 없게 만들어서, IP 주소 자체는 저장하지 않아요.',
            '메일 발송 기록에는 이메일 주소를 가린 형태로만 남겨요.',
            '데이터베이스와 백업에 접근할 수 있는 사람을 운영자로 제한하고, 접근에 쓰는 비밀값은 코드와 따로 관리해요.',
            '서버에 들어온 운영자의 접속 기록(접속 시각, 접속한 곳의 IP 주소, 한 작업)은 1년 동안 따로 보관하고 점검해요. 이 기록에는 이용자의 이메일 주소를 남기지 않아요.',
          ],
        },
      ],
    },
    {
      id: 'officer',
      title: '개인정보 보호책임자',
      legal: '법 제30조제1항제6호',
      blocks: [
        {
          ul: ['성명: {{KENNY:officerName}}', '메일: {{KENNY:officerEmail}}'],
        },
        { p: '개인정보 문의, 열람·정정·삭제 요청, 불만과 피해 구제 요청은 위 메일로 보내 주세요.' },
      ],
    },
    {
      id: 'remedy',
      title: '도움을 받을 수 있는 곳',
      legal: '권익침해 구제 안내(작성지침 권장)',
      blocks: [
        { p: '개인정보 침해로 도움이 필요하면 아래 기관에 문의할 수 있어요.' },
        // 각 기관 공식 사이트 직접 열람 2026-10-25(이름·번호는 페이지 표기 그대로, 확인한 것만):
        //   https://privacy.kisa.or.kr/main.do          — "한국인터넷진흥원 개인정보침해 신고센터 TEL. 118"
        //   https://www.kopico.go.kr/main/main.do       — "개인정보분쟁조정위원회 전화번호 1833-6972"
        //   https://www.spo.go.kr/site/spo/main.do      — 사이트 제목 "공소청(본청)", "1301공소청콜센터", "국번없이 1301"
        //                                                  (옛 대검찰청 표기는 쓰지 않는다 — 현재 기관명은 공소청)
        //   https://ecrm.police.go.kr/minwon/main       — "사이버범죄 신고시스템 (ECRM)", "국번 없이 182"
        {
          ul: [
            '한국인터넷진흥원 개인정보침해 신고센터: 118 (privacy.kisa.or.kr)',
            '개인정보분쟁조정위원회: 1833-6972 (www.kopico.go.kr)',
            '공소청: 국번 없이 1301 (www.spo.go.kr)',
            '경찰청 사이버범죄 신고시스템: 국번 없이 182 (ecrm.police.go.kr)',
          ],
        },
      ],
    },
    {
      id: 'overseas-collection',
      title: '국외에서 직접 수집',
      legal: '시행령 제31조제1항제4호',
      notApplicable: true,
      blocks: [{ p: '국외에서 국내 이용자의 개인정보를 직접 수집하지 않아요.' }],
    },
    {
      id: 'domestic-agent',
      title: '국내대리인',
      legal: '법 제31조의2제4항',
      notApplicable: true,
      blocks: [{ p: '국내에 있는 운영자가 직접 운영해서 국내대리인을 두지 않아요.' }],
    },
    {
      id: 'changes',
      title: '처리방침 변경',
      legal: '법 제30조제2항',
      blocks: [
        { p: '이 처리방침은 {{KENNY:effectiveDate}}부터 시행해요.' },
        { p: '내용을 바꾸면 시행 {const:CHANGE_NOTICE_DAYS}일 전에 이 페이지에서 알려요. 이전 버전은 아래에 남겨요.' },
      ],
    },
  ],
};

const TOKEN_RE = /\{policy:([A-Z0-9_]+)\}|\{const:([A-Z0-9_]+)\}/g;
const KENNY_RE = /\{\{KENNY:([A-Za-z0-9]+)\}\}/g;

/** 본문 문자열의 토큰 목록(검사·테스트용). */
export function tokensOf(text: string): { policy: string[]; derived: string[]; kenny: string[] } {
  const policy: string[] = [];
  const derived: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) policy.push(m[1]);
    else if (m[2] !== undefined) derived.push(m[2]);
  }
  const kenny = [...text.matchAll(KENNY_RE)].map((m) => m[1]);
  return { policy, derived, kenny };
}

/** 처리방침의 모든 문자열(린트·토큰 검사용, 결정론 순서). */
export function privacyStrings(p: PrivacyPolicy = PRIVACY_POLICY): string[] {
  const out: string[] = [p.version, p.effectiveDate, ...p.intro];
  for (const v of p.previousVersions) out.push(v.version, v.effectiveDate);
  for (const s of p.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if ('p' in b) out.push(b.p, ...(b.link ? [b.link.text] : []));
      else if ('ul' in b) out.push(...b.ul);
      else out.push(b.table.caption, ...b.table.head, ...b.table.rows.flat().flatMap((c) => (typeof c === 'string' ? [c] : [c.text, c.meta])));
    }
  }
  return out;
}

/**
 * 이미 HTML 이스케이프된 문자열의 토큰 치환. {policy:NAME} → span(data-ws-policy), {const:NAME} → 숫자.
 *   모르는 이름은 throw(빌드 실패 — 조용히 빈 값으로 내보내지 않는다). {{KENNY:키}} 는 그대로(목록 밖 키는 throw).
 */
export function fillTokens(escaped: string): string {
  for (const m of escaped.matchAll(KENNY_RE)) {
    if (!(KENNY_PLACEHOLDERS as readonly string[]).includes(m[1])) throw new Error(`privacy: 알 수 없는 자리표시 {{KENNY:${m[1]}}}`);
  }
  return escaped.replace(TOKEN_RE, (_all, policy: string | undefined, derived: string | undefined) => {
    if (policy !== undefined) {
      if (!Object.hasOwn(POLICY_PERIODS, policy)) throw new Error(`privacy: policy.ts 에 없는 기간 ${policy}`);
      const v = POLICY_PERIODS[policy as PolicyPeriodName];
      return `<span data-ws-policy="${policy}">${String(v)}</span>`;
    }
    const name = derived as string;
    if (!Object.hasOwn(DERIVED, name)) throw new Error(`privacy: 알 수 없는 상수 ${name}`);
    const v = DERIVED[name as DerivedName];
    if (!Number.isInteger(v) || v < 0) throw new Error(`privacy: ${name}=${v} 는 0 이상 정수가 아니다`);
    return String(v);
  });
}

const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?![A-Za-z0-9-])/g;

/**
 * 96 N2(K-2 준비) — 이스케이프·토큰 치환이 끝난 본문에서 메일 주소 글자를 mailto 링크로 감싼다.
 *   지금 본문 메일 자리는 {{KENNY:officerEmail}} 자리표시뿐이라 산출물은 바뀌지 않는다.
 *   K-2 로 실제 주소를 넣으면 렌더러가 링크로 만든다. 태그(속성값) 안은 건드리지 않고 태그 밖 글자 조각에만 적용.
 */
export function linkMailto(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith('<') ? part : part.replace(EMAIL_RE, (m) => `<a href="mailto:${m}">${m}</a>`)))
    .join('');
}

/** 처리방침 본문 링크는 내부 경로만('/x' — '//x'·'/\x'·스킴 금지). 아니면 throw(빌드 실패). */
export function assertInternalHref(href: string): string {
  if (!/^\/(?![/\\])[^\s"'<>\\]*$/.test(href)) throw new Error(`privacy: 내부 경로가 아닌 링크 ${href}`);
  return href;
}
