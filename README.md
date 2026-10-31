# WithSmall (위드스몰)

작은 반려동물(골든햄스터부터)을 처음 준비할 때 **무엇이 필요하고 무엇은 지금 필요 없는지를 종별 기준으로 먼저 결정해 주고**, 규격을 숫자로 판정하고, 기준에 맞는 준비물과 진료 병원까지 한곳에서 잇는 서비스. **"겉은 서비스, 속은 도구."**

정보 사이트도, 쇼핑몰도, 분양 플랫폼도 아니다.

## 구조적 불변식

매 변경에서 지키는 8가지 (원문: [docs/WithSmall-제품기획-v0.2.md](docs/WithSmall-제품기획-v0.2.md) §2, 요약: [CLAUDE.md](CLAUDE.md)).

1. 상품·외부 사이트를 크롤링하지 않는다. 가격·규격·이미지 자동 수집 금지, 이미지는 사용권을 확인해 기록한 것만.
2. 입양자를 선별·매칭하지 않는다. 동물 거래·분양·신청서 모델 없음.
3. 최소 규격 미달 제품은 추천 영역에 넣지 않는다. 노출 순서는 규격, 검수, 선호로 고정.
4. 플랫폼은 자금을 보유하지 않는다. 결제·에스크로·정산 코드 없음.
5. 의료 판단을 하지 않는다. "병원에 문의할 상황"까지만 안내하고, 콘텐츠 린트 금지어를 지킨다.
6. 사육·법적 정보는 마스터 데이터가 결정한다. AnimalType, Taxon, CareProfile, SupplyRequirement, SupplyItem을 섞지 않고, 최종값은 `resolveRequirement` 한 곳에서 계산한다.
7. 콘텐츠는 출처·검수자 유형·검수일·상태를 갖고, VERIFIED만 노출한다. `AI_DRAFT`는 VERIFIED가 될 수 없고, 후기는 승인되고 사용 확인된 것만 쓴다.
8. 실시간 위치를 저장하지 않는다. 시군구 텍스트와 게시글 옵션 핀만 쓴다.

## 스택

- npm workspaces 모노레포: `client`(Vite + React + TypeScript PWA), `server`(Express ESM, TypeScript)
- SQLite + Prisma (M2에서 Postgres 이전 예정)
- 동일 오리진 단일 컨테이너
- 빌드 타임 프리렌더(`scripts/prerender.mjs`): 시드를 정적 HTML과 하이드레이션으로 변환
- 네이버 지도 JS v3 (병원 페이지만)
- Vitest(server, client), GitHub Actions, `scripts/compliance-scan.mjs`

## 권위 문서

우선순위 순. 전체 색인은 [docs/README.md](docs/README.md).

1. [docs/WithSmall-제품기획-v0.2.md](docs/WithSmall-제품기획-v0.2.md) (v0.2.4): 정의, 불변식, 데이터 모델, 아키텍처
2. [docs/planning-artifacts/PRD.md](docs/planning-artifacts/PRD.md) (v1.3.1): 수용 기준, 부록 A/B
3. [docs/planning-artifacts/UX-기획.md](docs/planning-artifacts/UX-기획.md) (v2.3.1)
4. [docs/planning-artifacts/디자인-브리프.md](docs/planning-artifacts/디자인-브리프.md) 및 [docs/design/](docs/design/README.md)
5. [docs/planning-artifacts/골든햄스터-콘텐츠-시드-v1.0.md](docs/planning-artifacts/골든햄스터-콘텐츠-시드-v1.0.md) 및 [docs/planning-artifacts/seed-draft/](docs/planning-artifacts/seed-draft)
6. [이미지-소싱.md](docs/planning-artifacts/이미지-소싱.md), [베타-후기-수집.md](docs/planning-artifacts/베타-후기-수집.md): 운영 절차

## 설정

1. 루트에서 `npm install` (워크스페이스 일괄).
2. `.env.example`을 `.env`로 복사하고 값을 채운다. 시크릿은 커밋하지 않는다.
   - `DATABASE_URL`: SQLite 경로 (로컬 기본 `file:./dev.db`)
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`: 무작위 시크릿 (생성법은 `.env.example` 주석)
   - `REACTION_KEY_SECRET`: 익명 반응 키 HMAC용 무작위 시크릿 (운영에서 32자 이상, 없으면 기동 중단)
   - `MAIL_TRANSPORT`: 로컬은 `console`, 운영은 `resend`(`RESEND_API_KEY`·`MAIL_FROM` 필요)
   - `VITE_NAVER_MAP_CLIENT_ID`: 네이버 지도 Client ID (콘솔에서 도메인 제한)
   - 운영 변수 전체 표는 `.env.example` 상단과 [docs/ops/deploy.md](docs/ops/deploy.md) 참고.

## 개발 명령

```bash
npm run dev:server          # Express (http://localhost:3001)
npm run dev:client          # Vite   (http://localhost:5173)
npm run build               # client + server 빌드 후 프리렌더, 사전 압축
npm run seed:validate       # 시드 검증
npm run compliance          # 컴플라이언스 스캔
npm run lint
npm run typecheck
npm test -w server          # 서버 테스트 (Vitest)
npm test -w client          # 클라이언트 테스트 (Vitest)
npm run test:scripts        # scripts/ 테스트 (node --test)
npm run e2e                 # Playwright
```

## 배포·운영

도커 단일 컨테이너(동일 오리진). 절차와 환경 변수는 [docs/ops/deploy.md](docs/ops/deploy.md).

## 이력

이 저장소는 Outget(지도 기반 아울렛 보드)에서 피벗했다. 이전 문서는 [docs/legacy/outget/](docs/legacy/outget)와 [_archive/INDEX.md](_archive/INDEX.md)에 있다.
