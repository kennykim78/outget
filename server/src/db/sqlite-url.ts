// SQLite datasource URL 보정 — 연결 풀 1개(connection_limit=1).
//
// 왜: Prisma(5.x) SQLite 커넥터는 잠금 대기(busy_timeout 5초)를 엔진 작업 스레드를 붙잡은 채 동기로 한다. 대화형
//   트랜잭션($transaction(async tx => …))이 쓰기 잠금을 쥔 동안 다른 연결의 자동 커밋 쓰기들이 작업 스레드 수(≈ CPU 수)만큼
//   대기에 들어가면, 잠금을 쥔 트랜잭션의 다음 문장을 실행할 스레드가 없다 → 5초 뒤 쓰기는 P1008, 트랜잭션은 P2028(만료) → 500.
//   (CI ubuntu 2 vCPU 에서 QA95 D-3 "삭제 ∥ verify ∥ PUT" 경합이 DELETE 500 으로 재현. 코어 많은 로컬에선 드묾.)
//   연결이 1개면 SQLite 잠금 경합 자체가 프로세스 안에서 사라지고, 나머지 쿼리는 풀 대기열에서 비동기로 기다린다(스레드 점유 0).
//   SQLite 는 쓰기가 원래 직렬이라 처리량 손실은 읽기 동시성뿐 — Phase 0 단일 컨테이너 규모에서 무시 가능.
//   전제: 대화형 트랜잭션 콜백 안에서 tx 가 아닌 클라이언트로 쿼리하지 않는다(풀 1개면 pool_timeout 까지 대기).
//
// file: URL 에만 적용. 운영자가 connection_limit 을 명시했으면 그대로 둔다. 그 밖의 provider(M2 Postgres)는 변경 없음.
export const SQLITE_CONNECTION_LIMIT = 1;

export function sqliteDatasourceUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string' || !url.startsWith('file:')) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${SQLITE_CONNECTION_LIMIT}`;
}
