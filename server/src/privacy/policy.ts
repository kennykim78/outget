// 개인정보 보존 기간 — 단일 출처(P1, Kenny K-1 2026-10-25 · _workspace/decisions.md).
//   정리 작업(privacy/retention.ts)·세션/토큰 정리(save/session.ts 재노출)·/privacy 본문이 같은 값을 읽는다.
//   여기 값을 바꾸면 처리방침 본문도 같이 바뀐다 — 공개 후 변경은 시행 7일 전 고지(K-4).
//   "N일 보존" = 오늘(Asia/Seoul) 포함 최근 N개 달력일만 남긴다(일 단위 데이터). 시각 데이터는 now − N×24h.

/** 하루(ms). */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 미사용 User 자동 파기: 마지막 활동(max(SaveSnapshot.updatedAt, 최신 Session.createdAt, User.createdAt)) 후 365일. */
export const UNUSED_USER_RETENTION_DAYS = 365;
/** 익명 이벤트(EventLog.receivedDate, 서울 날짜) 90일. */
export const EVENT_LOG_RETENTION_DAYS = 90;
/** 익명 반응(ReactionSignal.createdAt) 400일 — reaction/anon-key.ts REACTION_KEY_WINDOW_DAYS 이하여야 한다(기동 검사). */
export const REACTION_RETENTION_DAYS = 400;
/** DB 백업 파일 7일(scripts/prune-backups.sh 의 WS_BACKUP_MAX_AGE_DAYS 기본값과 같다). */
export const BACKUP_RETENTION_DAYS = 7;
/**
 * 삭제 묘비(ErasureTombstone·묘비 파일) 7일 = 백업 보존 기간 — 그보다 오래된 백업은 남지 않으므로 묘비도 필요 없다.
 *   기한은 retainUntil(삭제 시 erasedAt+7일, 재적용으로 실제 삭제하면 max(기존, now+7일) — 복원 직후 새 백업이 7일 더 남으므로).
 *   WS_BACKUP_MAX_AGE_DAYS 는 이 값(=BACKUP_RETENTION_DAYS) 이하만 허용(101 MED-1).
 */
export const TOMBSTONE_RETENTION_DAYS = 7;
/** 매직 토큰 만료 후 보존. 0 = 만료 즉시 삭제 대상(이메일 담긴 행 최소 보존). */
export const MAGIC_TOKEN_RETENTION_MS = 0;
/** 세션 만료·폐기 후 보존. 0 = 즉시 삭제 대상. */
export const SESSION_RETENTION_MS = 0;
/** 정리 작업 주기(기동 1회 + 이 간격). */
export const RETENTION_INTERVAL_MS = DAY_MS;

/** 백업 나이 정리 env(scripts/prune-backups.sh 와 같은 이름). */
export const BACKUP_DIR_ENV = 'WS_BACKUP_DIR';
export const BACKUP_MAX_AGE_ENV = 'WS_BACKUP_MAX_AGE_DAYS';
export const DEFAULT_BACKUP_DIR = '/data/backup';

/**
 * 삭제 묘비 파일(백업 복원 대비, tombstone-file.ts). DB 와 같은 /data 볼륨이지만 백업 폴더 밖이어야 한다(기동 검사).
 *   한 줄 = {"emailSha256":<hex64>,"erasedAt":<ISO>,"retainUntil":<ISO>} — 이메일 원문 0. retainUntil 없는 옛 줄은 erasedAt+7일.
 */
export const ERASURE_FILE_ENV = 'WS_ERASURE_FILE';
export const DEFAULT_ERASURE_FILE = '/data/erasures.jsonl';
